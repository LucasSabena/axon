import type { Hono } from 'hono';
import { body, only, protect } from './storage/http';
import { MaintenanceError } from './storage/types';
import { CONTAINER, b64, q, runWithStdin, safeJson, sh } from './openbot-shared';

/* Agentes de OpenBot: detalle completo y edición de skills.
 *  - Skills: son archivos (SKILL.md) en la carpeta de trabajo de cada agente; se pueden crear, editar, borrar y
 *    copiar a otros agentes con seguridad. Las que trae OpenBot ("managed") no se tocan: él las vuelve a escribir.
 *  - Memoria, rutinas y configuración del agente: OpenBot las guarda en su registro de eventos. Escribirlas a mano en
 *    la base lo dejaría inconsistente, así que acá solo se leen; se editan en la app de OpenBot. */

export const AGENT_ID = /^agent-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_SKILL = 200_000;
const ROOT = '/data/OpenBot/Agents';
const wsOf = (id: string) => `${ROOT}/${id}`;

export interface SkillInfo { slug: string; managed: boolean; inAgents: boolean; inClaude: boolean; size: number; updated: number; description: string }

/** Valida un SKILL.md: frontmatter con `name` igual al slug y `description` no vacía. */
export function validateSkill(slug: string, content: string): string | null {
  if (!SLUG.test(slug)) return 'El nombre debe tener minúsculas, números y guiones (máx. 64), p. ej. "informe-diario"';
  if (!content.trim()) return 'El contenido está vacío';
  if (content.length > MAX_SKILL) return 'La skill es demasiado grande (máx. 200 KB)';
  // eslint-disable-next-line no-control-regex
  if (/\u0000/.test(content)) return 'El contenido no puede tener caracteres nulos';
  const m = content.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return 'Falta el encabezado: la skill debe empezar con --- y los campos name y description';
  const field = (k: string) => m[1].split(/\r?\n/).map((l) => l.match(new RegExp(`^${k}:\\s*(.*)$`))).find(Boolean)?.[1]?.trim().replace(/^["']|["']$/g, '') || '';
  if (field('name') !== slug) return `El campo name del encabezado debe ser exactamente "${slug}"`;
  if (!field('description')) return 'Falta el campo description en el encabezado: es lo que le dice al agente cuándo usar la skill';
  return null;
}

export const SKILL_TEMPLATE = (slug: string) => `---\nname: ${slug}\ndescription: Explicá en una frase cuándo debe usar esta skill el agente.\n---\n\n# ${slug}\n\nEscribí acá las instrucciones paso a paso.\n`;

export function parseSkillList(out: string): SkillInfo[] {
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [slug, m, a, c, size, mt, ...desc] = l.split('|');
    if (!SLUG.test(slug || '')) return null;
    return { slug, managed: m === '1', inAgents: a === '1', inClaude: c === '1', size: Number(size) || 0, updated: Number(mt) || 0, description: desc.join('|').trim().replace(/^["']|["']$/g, '').slice(0, 300) } as SkillInfo;
  }).filter((x): x is SkillInfo => !!x).sort((a, b) => Number(a.managed) - Number(b.managed) || a.slug.localeCompare(b.slug));
}

const LIST_SKILLS_SH = (ws: string) => `W=${q(ws)}; for s in $(ls -1 "$W/.agents/skills" "$W/.claude/skills" 2>/dev/null | grep -E '^[a-z0-9][a-z0-9-]{0,63}$' | sort -u); do a=0; c=0; m=0; f=""; if [ -f "$W/.agents/skills/$s/SKILL.md" ]; then a=1; f="$W/.agents/skills/$s/SKILL.md"; fi; if [ -f "$W/.claude/skills/$s/SKILL.md" ]; then c=1; [ -z "$f" ] && f="$W/.claude/skills/$s/SKILL.md"; fi; [ -z "$f" ] && continue; if [ -f "$W/.agents/skills/$s/.openbot-managed.json" ] || [ -f "$W/.claude/skills/$s/.openbot-managed.json" ]; then m=1; fi; size=$(stat -c %s "$f"); mt=$(stat -c %Y "$f"); desc=$(sed -n 's/^description:[[:space:]]*//p' "$f" | head -n 1 | cut -c1-300); echo "$s|$m|$a|$c|$size|$mt|$desc"; done`;
const inBot = (script: string, stdin = false) => `docker exec ${stdin ? '-i ' : ''}${CONTAINER} sh -c ${q(script)}`;

// ---------------------------------------------------------------- base de datos (copia, solo lectura)
const AGENTS_PY = String.raw`
import json, sqlite3, sys
path, only = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '')
db = sqlite3.connect(path); db.row_factory = sqlite3.Row
def jl(s, d):
    try: return json.loads(s)
    except Exception: return d
def sched(s):
    j = jl(s, {})
    return j
agents = []
for r in db.execute('select agent_id, model, agent_json, updated_at from projection_agents order by sort_order'):
    j = jl(r['agent_json'], {})
    if j.get('archived') or j.get('deletedAt'): continue
    if only and r['agent_id'] != only: continue
    aid = r['agent_id']
    a = dict(id=aid, name=j.get('name') or aid, title=j.get('title') or '', description=j.get('description') or '', model=j.get('model') or r['model'],
        effort=j.get('reasoningEffort'), provider=j.get('provider'), access=j.get('access'), computerUse=j.get('computerUse'), notifications=j.get('notifications'),
        workspacePath=j.get('workspacePath'), updatedAt=j.get('updatedAt') or r['updated_at'])
    a['memoryCount'] = db.execute('select count(*) from projection_agent_memories where agent_id = ?', (aid,)).fetchone()[0]
    a['routineCount'] = db.execute('select count(*) from projection_agent_routines where agent_id = ?', (aid,)).fetchone()[0]
    a['activeRoutines'] = db.execute('select count(*) from projection_agent_routines where agent_id = ? and active = 1', (aid,)).fetchone()[0]
    if only:
        a['memories'] = [dict(id=m['memory_id'], text=m['text'], origin=m['origin'], inclusion=m['inclusion'] or 'searchable', userControlled=bool(m['user_controlled']), createdAt=m['created_at'], updatedAt=m['updated_at'])
            for m in db.execute('select m.*, s.inclusion, s.user_controlled from projection_agent_memories m left join agent_memory_selections s on s.memory_id = m.memory_id where m.agent_id = ? order by m.created_at desc', (aid,))]
        routines = []
        for ro in db.execute('select * from projection_agent_routines where agent_id = ? order by created_at', (aid,)):
            t = db.execute('select schedule_json, next_run_at from projection_routine_triggers where routine_id = ?', (ro['routine_id'],)).fetchone()
            runs = [dict(status=x['status'], scheduledFor=x['scheduled_for'], createdAt=x['created_at'], error=(x['error'] or '')[:300], source=x['run_source'])
                for x in db.execute('select status, scheduled_for, created_at, error, run_source from projection_routine_runs where routine_id = ? order by created_at desc limit 5', (ro['routine_id'],))]
            routines.append(dict(id=ro['routine_id'], name=ro['name'], instruction=ro['instruction'], active=bool(ro['active']), timezone=ro['timezone'], limitPolicy=ro['limit_policy'], missedPolicy=ro['missed_policy'],
                schedule=sched(t['schedule_json']) if t else None, nextRunAt=t['next_run_at'] if t else None, runs=runs, createdAt=ro['created_at']))
        a['routines'] = routines
    agents.append(a)
print(json.dumps(dict(ok=True, agents=agents)))
`;

async function readAgentsDb(only = ''): Promise<any[]> {
  const cmd = ['T=$(mktemp -d) || exit 1; trap \'rm -rf "$T"\' EXIT',
    `docker cp ${CONTAINER}:/data/.config/OpenBot/openbot.db "$T/openbot.db" >/dev/null 2>&1 || { echo '{"ok":false}'; exit 0; }`,
    `docker cp ${CONTAINER}:/data/.config/OpenBot/openbot.db-wal "$T/openbot.db-wal" >/dev/null 2>&1 || true`,
    `echo ${b64(AGENTS_PY)} | base64 -d | python3 - "$T/openbot.db" ${q(only)}`].join('; ');
  const r = await sh(cmd, 40_000);
  const data = safeJson<{ ok: boolean; agents: any[] }>(r.stdout.trim().split('\n').pop() || '');
  if (!data?.ok) throw new MaintenanceError('No se pudo leer la base de OpenBot', 503);
  return data.agents;
}
const skillsOf = async (id: string) => parseSkillList((await sh(inBot(LIST_SKILLS_SH(wsOf(id))), 20_000)).stdout);

async function requireAgent(id: unknown): Promise<string> {
  if (typeof id !== 'string' || !AGENT_ID.test(id)) throw new MaintenanceError('Agente no válido', 400);
  if (!(await readAgentsDb(id)).length) throw new MaintenanceError('Ese agente no existe', 404);
  return id;
}

async function writeSkill(id: string, slug: string, content: string) {
  const ws = wsOf(id);
  const script = `set -e; W=${q(ws)}; S=${q(slug)}; for d in .agents .claude; do if [ -f "$W/$d/skills/$S/.openbot-managed.json" ]; then echo MANAGED; exit 7; fi; done; for d in .agents .claude; do mkdir -p "$W/$d/skills/$S"; done; cat > "$W/.agents/skills/$S/SKILL.md.new"; cp "$W/.agents/skills/$S/SKILL.md.new" "$W/.claude/skills/$S/SKILL.md.new"; for d in .agents .claude; do mv "$W/$d/skills/$S/SKILL.md.new" "$W/$d/skills/$S/SKILL.md"; done`;
  const r = await runWithStdin(inBot(script, true), content, 'user', 30_000);
  if (/MANAGED/.test(r.stdout)) throw new MaintenanceError('Esa skill la administra OpenBot: no se puede modificar', 409);
  if (!r.ok) throw new MaintenanceError('No se pudo guardar la skill en el agente', 503);
}

export function registerOpenBotAgents(app: Hono) {
  protect(app, '/api/openbot/agents');
  const fail = (c: any, e: unknown, fallback: string) => (e instanceof MaintenanceError ? e.getResponse() : c.json({ ok: false, error: fallback }, 503));

  app.get('/api/openbot/agents', async (c) => {
    try {
      const agents = await readAgentsDb();
      const skills = await Promise.all(agents.map((a) => skillsOf(a.id).catch(() => [] as SkillInfo[])));
      return c.json({ ok: true, agents: agents.map((a, i) => ({ ...a, skillCount: skills[i].length })) });
    } catch (e) { return fail(c, e, 'No se pudieron leer los agentes'); }
  });

  app.get('/api/openbot/agents/detail', async (c) => {
    try {
      const id = await requireAgent(c.req.query('id'));
      const [agent] = await readAgentsDb(id);
      return c.json({ ok: true, agent, skills: await skillsOf(id), template: 'nueva-skill' });
    } catch (e) { return fail(c, e, 'No se pudo leer el agente'); }
  });

  app.get('/api/openbot/agents/skill', async (c) => {
    try {
      const id = await requireAgent(c.req.query('id')); const slug = c.req.query('slug') || '';
      if (!SLUG.test(slug)) throw new MaintenanceError('Skill no válida', 400);
      const r = await sh(inBot(`W=${q(wsOf(id))}; S=${q(slug)}; f="$W/.agents/skills/$S/SKILL.md"; [ -f "$f" ] || f="$W/.claude/skills/$S/SKILL.md"; [ -f "$f" ] || exit 4; head -c ${MAX_SKILL} "$f"`), 20_000);
      if (!r.ok) throw new MaintenanceError('Esa skill no existe', 404);
      const managed = (await skillsOf(id)).find((s) => s.slug === slug)?.managed ?? false;
      return c.json({ ok: true, slug, content: r.stdout, managed });
    } catch (e) { return fail(c, e, 'No se pudo leer la skill'); }
  });

  app.post('/api/openbot/agents/skill', async (c) => {
    try {
      const b = await body(c); only(b, ['id', 'slug', 'content', 'copyTo', 'confirm']);
      if (typeof b.id !== 'string' || !AGENT_ID.test(b.id)) throw new MaintenanceError('Agente no válido', 400);
      const slug = typeof b.slug === 'string' ? b.slug : ''; const content = typeof b.content === 'string' ? b.content : '';
      const bad = validateSkill(slug, content); if (bad) throw new MaintenanceError(bad, 400);   // validar antes de tocar el host
      const id = await requireAgent(b.id);
      const targets = [id];
      if (b.copyTo !== undefined) {
        if (!Array.isArray(b.copyTo) || b.copyTo.length > 20) throw new MaintenanceError('Lista de agentes no válida', 400);
        for (const t of b.copyTo) { const tid = await requireAgent(t); if (!targets.includes(tid)) targets.push(tid); }
      }
      for (const t of targets) await writeSkill(t, slug, content);
      return c.json({ ok: true, saved: targets.length, message: targets.length > 1 ? `Skill guardada en ${targets.length} agentes.` : 'Skill guardada. El agente la usa desde su próximo turno.' });
    } catch (e) { return fail(c, e, 'No se pudo guardar la skill'); }
  });

  app.post('/api/openbot/agents/skill/delete', async (c) => {
    try {
      const b = await body(c); only(b, ['id', 'slug', 'confirm']);
      const id = await requireAgent(b.id); const slug = typeof b.slug === 'string' ? b.slug : '';
      if (!SLUG.test(slug)) throw new MaintenanceError('Skill no válida', 400);
      if (b.confirm !== true) throw new MaintenanceError('Falta la confirmación', 400);
      const info = (await skillsOf(id)).find((s) => s.slug === slug);
      if (!info) throw new MaintenanceError('Esa skill no existe', 404);
      if (info.managed) throw new MaintenanceError('Esa skill la administra OpenBot: no se puede borrar', 409);
      const ws = wsOf(id);
      const r = await sh(inBot(`W=${q(ws)}; S=${q(slug)}; rm -rf "$W/.agents/skills/$S" "$W/.claude/skills/$S"`), 20_000);
      if (!r.ok) throw new MaintenanceError('No se pudo borrar la skill', 503);
      return c.json({ ok: true, message: 'Skill borrada.' });
    } catch (e) { return fail(c, e, 'No se pudo borrar la skill'); }
  });
}
