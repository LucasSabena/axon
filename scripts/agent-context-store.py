"""Host-side adapters. Native stores are read-only; edits use Engram's API
or compare-and-swap + backups for Markdown. No agent credentials are read.
Axon's disposable FTS index contains only rendered conversation content.
"""
import os, sys, json, sqlite3, hashlib, time, re, glob, urllib.request, urllib.error, tempfile, fcntl
from pathlib import Path
from datetime import datetime, timezone

class Failure(Exception):
    def __init__(self, message, status=400): self.status=status; super().__init__(message)

def digest(value): return hashlib.sha256(value.encode()).hexdigest()
def ident(agent, source): return digest(agent+':'+source)
def stamp(value):
    if isinstance(value,(int,float)): return value
    try:
        parsed=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()*1000
    except Exception: return 0

def connection(p):
    db=sqlite3.connect(Path(p).as_uri()+'?mode=ro',uri=True,timeout=2)
    db.row_factory=sqlite3.Row
    db.execute('pragma query_only=on')
    # Bound scans on very large native stores; never run a migration or VACUUM.
    deadline=time.monotonic()+12
    db.set_progress_handler(lambda: int(time.monotonic()>deadline),10000)
    return db

def walk(root, suffixes, depth=8):
    root=Path(root)
    if not root.is_dir() or root.is_symlink(): return
    for directory, dirs, files in os.walk(root,followlinks=False):
        dirs[:]=[d for d in dirs if d not in ['.git','node_modules','__pycache__'] and not Path(directory,d).is_symlink()]
        if len(Path(directory).relative_to(root).parts)>=depth: dirs[:]=[]
        for name in sorted(files):
            p=Path(directory,name)
            if not p.is_symlink() and p.suffix in suffixes: yield p

def parse_json(s):
    try: return json.loads(s)
    except (ValueError,TypeError): return {}

def account_roots(home, kind):
    # Bounded, read-only discovery of AXON-managed account histories. Never
    # inspect credentials or traverse shared configuration symlinks.
    base=home/'.local/share/axon/agent-accounts'
    if not base.is_dir() or base.is_symlink():return []
    roots=[]
    for agent,subdirs in [('codex',['sessions','archived_sessions'] if kind=='chats' else ['memories']),('claude',['projects'])]:
        folder=base/agent
        if folder.is_symlink() or not folder.is_dir():continue
        for profile in sorted(folder.iterdir())[:24]:
            if not re.fullmatch(r'(?:current|a-[a-f0-9]{16})',profile.name) or profile.is_symlink() or not profile.is_dir():continue
            roots.extend((agent,profile/s) for s in subdirs)
    return roots

def blocks(content):
    if isinstance(content,str): yield ('text',content)
    elif isinstance(content,list):
        for b in content:
            if not isinstance(b,dict): continue
            kind=b.get('type','')
            if kind in ['text','input_text','output_text']: yield ('text',str(b.get('text','')))
            elif kind in ['tool_use','tool-call','tool']:
                state=b.get('state') or {}
                yield ('tool', str(b.get('name') or b.get('tool') or 'Herramienta')+'\n'+json.dumps(b.get('input') or b.get('args') or state.get('input') or {},ensure_ascii=False))
                output=state.get('output') or b.get('output')
                if output: yield ('tool',str(output))
            elif kind in ['tool_result','tool-result']: yield ('tool',str(b.get('content') or b.get('output') or ''))
            elif kind=='file': yield ('file',str(b.get('path') or b.get('filename') or b.get('url') or 'Archivo adjunto'))

def json_events(p):
    if p.suffix=='.json':
        with p.open() as f: data=json.load(f)
        yield data
    else:
        with p.open(errors='replace') as f:
            for line in f:
                # Ignore incomplete last records while a session is running.
                o=parse_json(line)
                if isinstance(o,dict):
                    yield o

def gemini_events(p):
    messages=[]
    for o in json_events(p):
        # These are replacements, not additional messages. Replaying every
        # snapshot would duplicate the conversation at each turn.
        if isinstance(o.get('messages'),list):messages=o['messages']
        elif isinstance(o.get('$set'),dict) and isinstance(o['$set'].get('messages'),list):messages=o['$set']['messages']
        elif o.get('type') in ['user','gemini','assistant']:messages.append(o)
    yield from messages

def file_messages(agent,p):
    for o in gemini_events(p) if agent=='gemini' else json_events(p):
        if agent=='codex':
            if o.get('type')!='response_item': continue
            d=o.get('payload') or {}; role=d.get('role','')
            # Hidden reasoning and system/developer instructions are not chats.
            if d.get('type')=='message' and role in ['user','assistant']:
                for kind,text in blocks(d.get('content')): yield {'role':role,'kind':kind,'text':text,'at':o.get('timestamp')}
            elif d.get('type') in ['function_call','custom_tool_call']:
                yield {'role':'tool','kind':'tool','text':str(d.get('name',''))+'\n'+str(d.get('arguments') or d.get('input') or ''),'at':o.get('timestamp')}
            elif d.get('type') in ['function_call_output','custom_tool_call_output']:
                yield {'role':'tool','kind':'tool','text':str(d.get('output','')),'at':o.get('timestamp')}
        elif agent=='claude':
            if o.get('type') not in ['user','assistant']: continue
            d=o.get('message') or {}
            for kind,text in blocks(d.get('content')):
                yield {'role':'tool' if kind=='tool' else o['type'],'kind':kind,'text':text,'at':o.get('timestamp')}
        elif agent=='gemini':
            role=o.get('type')
            if role not in ['user','gemini','assistant']: continue
            for kind,text in blocks(o.get('content')):
                yield {'role':'assistant' if role=='gemini' else role,'kind':kind,'text':text,'at':o.get('timestamp')}
            for call in o.get('toolCalls',[]):
                yield {'role':'tool','kind':'tool','text':json.dumps(call,ensure_ascii=False),'at':o.get('timestamp')}

def header(agent,p):
    cwd=''; title=p.stem; native=p.stem
    if p.suffix=='.json': events=list(json_events(p))[:12]
    else:
        with p.open(errors='replace') as f: events=[parse_json(l) for l in f.read(160000).splitlines()]
    for o in events:
        if not isinstance(o,dict): continue
        d=o.get('payload') or {}
        cwd=cwd or o.get('cwd') or (d.get('cwd') if isinstance(d,dict) else '') or o.get('projectPath') or ''
        native=o.get('sessionId') or (d.get('id') if o.get('type')=='session_meta' else '') or native
        if o.get('type')=='summary': title=o.get('summary') or title
        if title==p.stem:
            content=(o.get('message') or {}).get('content') if agent=='claude' and o.get('type')=='user' else d.get('content') if agent=='codex' and d.get('role')=='user' else o.get('content') if agent=='gemini' and o.get('type')=='user' else None
            for kind,text in blocks(content):
                if kind=='text' and not text.lstrip().startswith(('<environment_context>','# AGENTS.md','<external_codex')):
                    title=re.sub(r'\s+',' ',text)[:140];break
    if agent=='gemini' and not cwd:
        # Gemini stores its actual directory in project_root, when present.
        root=p.parent.parent/'project_root'
        if root.is_file(): cwd=root.read_text().strip()
        else: cwd='Gemini · '+p.parent.parent.name
    return cwd,title,native

class Store:
    def __init__(self,request):
        self.r=request; self.home=Path(request['home']); self.projects=request.get('projects',[])
        self.state=self.home/'.local/share/axon/agent-context'
        self.state.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(self.state,0o700)
        self.lock=(self.state/('memory.lock' if request['kind']=='memories' else 'index.lock')).open('a');fcntl.flock(self.lock,fcntl.LOCK_EX)
        self.warnings=[]
        if request['kind']=='memories':return
        self.index=sqlite3.connect(self.state/'index.sqlite',timeout=20);self.index.row_factory=sqlite3.Row
        os.chmod(self.state/'index.sqlite',0o600)
        self.index.execute('create table if not exists chats (id text primary key,agent text,source text,locator text,project text,title text,updated real,size integer,signature text,indexed text,version text)')
        self.index.execute('create table if not exists metadata(key text primary key,value text)')
        version=self.index.execute("select value from metadata where key='search_version'").fetchone()
        if not version or version[0]!='messages-and-file-references-v3':
            # Only Axon's disposable cache is migrated, never a native store.
            self.index.execute('drop table if exists chat_search')
            self.index.execute("update chats set indexed=''")
            self.index.execute("insert or replace into metadata values('search_version','messages-and-file-references-v3')")
            self.index.commit();self.index.execute('vacuum')
        self.index.execute('create virtual table if not exists chat_search using fts5(id unindexed,text,tokenize="unicode61")')
        self.warnings=[]
    def project(self,cwd):
        # Worktrees belong to their original project, while keeping source paths.
        cwd=re.split(r'/\.(?:claude/worktrees|worktrees)/',cwd)[0]
        candidates=[p for p in self.projects if cwd==p['cwd'] or cwd.startswith(p['cwd']+'/')]
        return max(candidates,key=lambda p:len(p['cwd']))['cwd'] if candidates else cwd or 'Sin proyecto'
    def refresh(self):
        ids=set()
        titles={}
        for p in sorted(self.home.glob('.codex/state_*.sqlite')):
            try:
                with connection(p) as db:
                    for r in db.execute('select id,title,cwd,rollout_path from threads'):
                        titles[r['rollout_path']]=(r['id'],r['title'],r['cwd'])
            except sqlite3.Error: pass
        title_index={}
        p=self.home/'.codex/session_index.jsonl'
        if p.is_file():
            for r in json_events(p):
                if r.get('id'):title_index[r['id']]=r.get('thread_name')
        roots=[('codex',self.home/'.codex/sessions'),('codex',self.home/'.codex/archived_sessions'),('claude',self.home/'.claude/projects'),('gemini',self.home/'.gemini/tmp')]
        roots.extend(account_roots(self.home,'chats'))
        for r in self.r.get('agentRoots',[]):
            agent=r['agent'];base=Path(r['root'])
            for sub in {'codex':['sessions','archived_sessions'],'claude':['projects'],'gemini':['tmp']}.get(agent,[]): roots.append((agent,base/sub))
        roots=list(dict.fromkeys(roots))
        for agent,root in roots:
            for p in walk(root,{'.jsonl','.json'}):
                if agent=='claude' and ('memory' in p.parts or p.name=='sessions-index.json'):continue
                if agent=='gemini' and (p.parent.name!='chats' or not p.name.startswith('session-')):continue
                sid=ident(agent,str(p));ids.add(sid)
                try:s=p.stat()
                except OSError:continue  # vanished between walk and stat
                sig=str(s.st_mtime_ns)+':'+str(s.st_size)
                old=self.index.execute('select signature from chats where id=?',(sid,)).fetchone()
                if old and old[0]==sig:
                    if str(p) in titles:
                        native,title,cwd=titles[str(p)]
                        self.index.execute('update chats set title=?,project=? where id=?',(title,self.project(cwd),sid))
                    continue
                try: cwd,title,native=header(agent,p)
                except (OSError,ValueError):self.warnings.append('Un historial no pudo leerse: '+str(p));continue
                if str(p) in titles:native,title,cwd=titles[str(p)]
                elif agent=='codex':title=title_index.get(native) or title
                self.index.execute('insert into chats values(?,?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set project=excluded.project,title=excluded.title,updated=excluded.updated,size=excluded.size,signature=excluded.signature', (sid,agent,str(p),native,self.project(cwd),title,s.st_mtime*1000,s.st_size,sig,'','file'))
        dbpath=self.home/'.local/share/opencode/opencode.db'
        if dbpath.is_file():
            try:
                with connection(dbpath) as db:
                    tables={x[0] for x in db.execute("select name from sqlite_master where type='table'")}
                    for table in ['session_v2','session']:
                        if table not in tables:continue
                        for row in db.execute('select id,directory,title,time_updated from '+table):
                            native=row['id'];sid=ident('opencode',table+':'+native);ids.add(sid);sig=str(row['time_updated'])
                            self.index.execute('insert into chats values(?,?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set project=excluded.project,title=excluded.title,updated=excluded.updated,signature=excluded.signature',(sid,'opencode',str(dbpath),native,self.project(row['directory']),row['title'] or native,row['time_updated'],0,sig,'',table))
            except sqlite3.Error:self.warnings.append('OpenCode no pudo leerse en este momento; se conserva su índice anterior.')
        # Delete disappeared files, but retain DB entries if a store is temporarily unavailable.
        for row in self.index.execute("select id,source from chats where version='file'").fetchall():
            if row['id'] not in ids and not Path(row['source']).exists():
                self.index.execute('delete from chats where id=?',(row['id'],));self.index.execute('delete from chat_search where id=?',(row['id'],))
        self.index.commit()
    def row(self,sid):
        row=self.index.execute('select * from chats where id=?',(sid,)).fetchone()
        if not row:raise Failure('Conversación no encontrada',404)
        return dict(row)
    def messages(self,row):
        if row['version']=='file':
            p=Path(row['source'])
            if p.is_symlink() or not p.is_file():raise Failure('El historial ya no está disponible',404)
            yield from file_messages(row['agent'],p)
        else:
            with connection(row['source']) as db:
                if row['version']=='session_v2':
                    for m in db.execute('select type,data,time_created from session_message where session_id=? order by seq,id',(row['locator'],)):
                        d=parse_json(m['data']);role=m['type']
                        if role in ['user','assistant','compaction','synthetic']:
                            content=d.get('content') or d.get('text') or d.get('summary') or ''
                            for kind,text in blocks(content):yield {'role':role,'kind':kind,'text':text,'at':m['time_created']}
                else:
                    for m in db.execute('select id,data,time_created from message where session_id=? order by time_created,id',(row['locator'],)):
                        role=parse_json(m['data']).get('role','assistant')
                        for p in db.execute('select data from part where message_id=? order by time_created,id',(m['id'],)):
                            for kind,text in blocks([parse_json(p[0])]):yield {'role':role if kind!='tool' else 'tool','kind':kind,'text':text,'at':m['time_created']}
    def build_search(self):
        # Incremental and bounded. A partially indexed search is always disclosed.
        deadline=time.monotonic()+4
        rows=self.index.execute('select * from chats where signature!=indexed order by updated desc').fetchall()
        for row in rows:
            if time.monotonic()>deadline:break
            try:
                # Full tools remain in the reader/export. Search their file
                # references instead of duplicating gigabytes of command output.
                text='\n'.join(m['text'] if m['kind']!='tool' else '\n'.join(file_refs(m['text'])) for m in self.messages(dict(row)))
                self.index.execute('delete from chat_search where id=?',(row['id'],))
                self.index.execute('insert into chat_search values(?,?)',(row['id'],text))
                self.index.execute('update chats set indexed=signature where id=?',(row['id'],))
            except (OSError,sqlite3.Error,Failure):self.warnings.append('Un chat no pudo indexarse: '+row['title'])
        self.index.commit()
        return self.index.execute('select count(*) from chats where signature!=indexed').fetchone()[0]
    def chats(self):
        self.refresh();pending=self.build_search();q=str(self.r.get('q') or '').strip();agent=self.r.get('agent');project=self.r.get('project')
        where=[];args=[]
        if agent:where.append('agent=?');args.append(agent)
        if project:where.append('project=?');args.append(project)
        if q:
            expression=' AND '.join('"'+s.replace('"','""')+'"' for s in q.split())
            where.append('(title like ? or source like ? or project like ? or id in (select id from chat_search where chat_search match ?))');args += ['%'+q+'%']*3+[expression]
        clause=' where '+' and '.join(where) if where else ''
        total=self.index.execute('select count(*) from chats'+clause,args).fetchone()[0]
        offset=max(0,int(self.r.get('offset') or 0));limit=40
        rows=[dict(x) for x in self.index.execute('select id,agent,source,project,title,updated from chats'+clause+' order by updated desc,id limit ? offset ?',args+[limit,offset])]
        projects=[dict(x) for x in self.index.execute('select project,count(*) as count from chats group by project order by project')]
        return dict(ok=True,items=rows,total=total,next=offset+limit if offset+limit<total else None,projects=projects,pending=pending,warnings=self.warnings)
    def detail(self):
        row=self.row(self.r['id']);offset=max(0,int(self.r.get('offset') or 0));items=[];files=set();more=False
        for i,m in enumerate(self.messages(row)):
            if i<offset:continue
            if len(items)>=80:more=True;break
            m['id']=str(i);items.append(m)
            files.update(file_refs(m['text']))
        return dict(ok=True,item=row,messages=items,files=sorted(files),next=offset+len(items) if more else None)
    def export(self):
        row=self.row(self.r['id']);lines=['# '+row['title'],'','Proyecto: '+row['project'],'Agente: '+row['agent'],'Origen: '+row['source'],'ID original: '+row['locator'],''];files=set()
        for m in self.messages(row):
            lines+=['## '+m['role']+' · '+str(m.get('at') or ''),'',m['text'],''];files.update(file_refs(m['text']))
        lines+=['## Archivos referenciados','']+['- `'+p+'`' for p in sorted(files)]
        return dict(ok=True,markdown='\n'.join(lines))
    def memories(self):
        rows=[];claude_projects={};p=self.home/'.engram/engram.db'
        if p.is_file():
            try:
                with connection(p) as db:
                    for r in db.execute('select id,title,content,type,project,scope,topic_key,updated_at,revision_count from observations where deleted_at is null'):
                        d=dict(r);rows.append(dict(id='engram-'+str(d['id']),agent='engram',title=d['title'],content=d['content'],project=d['project'] or 'Global',type=d['type'],source=str(p),updated=stamp(d['updated_at']),scope=d['scope'],topic=d['topic_key'],editable=True))
            except sqlite3.Error:self.warnings.append('Engram no pudo leerse en este momento.')
        roots=[('codex',self.home/'.codex/memories'),('claude',self.home/'.claude/projects'),('windsurf',self.home/'.codeium/windsurf/memories')]
        roots.extend(account_roots(self.home,'memories'))
        for r in self.r.get('agentRoots',[]):
            agent=r['agent'];base=Path(r['root'])
            for sub in {'codex':['memories'],'claude':['projects']}.get(agent,[]): roots.append((agent,base/sub))
        roots=list(dict.fromkeys(roots))
        for agent,root in roots:
            for p in walk(root,{'.md'},depth=6):
                if agent=='codex' and p.name not in ['MEMORY.md','memory_summary.md','raw_memories.md'] and 'rollout_summaries' not in p.parts and 'notes' not in p.parts:continue
                if agent=='claude' and 'memory' not in p.relative_to(root).parts:continue
                try:
                    if p.stat().st_size>1_000_000:self.warnings.append('Memoria demasiado grande para el editor: '+str(p));continue
                    content=p.read_text();project='Global'
                    if agent=='claude':
                        folder=p.relative_to(root).parts[0];project=folder
                        if folder not in claude_projects:
                            sample=next((x for x in (root/folder).glob('*.jsonl') if x.is_file() and not x.is_symlink()),None)
                            try:claude_projects[folder]=self.project(header('claude',sample)[0]) if sample else folder
                            except (OSError,ValueError):claude_projects[folder]=folder
                        project=claude_projects[folder]
                        for pr in self.projects:
                            if pr['cwd'].replace('/','-')==folder:project=pr['cwd'];break
                    title=next((l.lstrip('# ').strip() for l in content.splitlines() if l.strip()),p.name)[:140]
                    rows.append(dict(id=ident(agent,str(p)),agent=agent,title=title,content=content,project=project,type='markdown',source=str(p),updated=p.stat().st_mtime*1000,editable=True))
                except (OSError,UnicodeError):self.warnings.append('Memoria no legible: '+str(p))
        return rows
    def memory_detail(self):
        row=next((x for x in self.memories() if x['id']==self.r['id']),None)
        if not row:raise Failure('Memoria no encontrada',404)
        row['revision']=memory_revision(row)
        return dict(ok=True,item=row,files=sorted(file_refs(row['content'])))
    def memory_list(self):
        allrows=self.memories();rows=allrows;q=str(self.r.get('q') or '').lower().strip()
        if q:rows=[r for r in rows if q in '\n'.join(str(r.get(k,'')) for k in ['title','content','source','project','type','topic']).lower()]
        for key in ['agent','project','type']:
            if self.r.get(key):rows=[r for r in rows if r[key]==self.r[key]]
        rows.sort(key=lambda r:(-r['updated'],r['id']));offset=max(0,int(self.r.get('offset') or 0));total=len(rows)
        counts={}
        for r in allrows:counts[r['project']]=counts.get(r['project'],0)+1
        return dict(ok=True,items=[{k:v for k,v in r.items() if k!='content'} for r in rows[offset:offset+40]],total=total,next=offset+40 if offset+40<total else None,projects=[dict(project=p,count=n) for p,n in sorted(counts.items())],types=sorted({r['type'] for r in allrows}),warnings=self.warnings,pending=0)
    def save(self):
        row=self.memory_detail()['item']
        if row['revision']!=self.r['revision']:raise Failure('La memoria cambió desde que la abriste. Recargala antes de guardar.',409)
        content=self.r['content']
        if not isinstance(content,str) or len(content.encode())>1_000_000:raise Failure('Memoria demasiado grande')
        if row['agent']=='engram':
            title=self.r.get('title',row['title'])
            if not isinstance(title,str) or not title.strip() or len(title)>500:raise Failure('Título inválido')
            backup=self.state/'backups';backup.mkdir(exist_ok=True,mode=0o700);prune_backups(backup)
            name=backup/(row['id']+'-'+str(time.time_ns())+'.json');name.write_text(json.dumps(row,ensure_ascii=False));os.chmod(name,0o600)
            payload=json.dumps(dict(title=title,content=content)).encode()
            port=int(os.environ.get('ENGRAM_PORT','7437'))
            req=urllib.request.Request('http://127.0.0.1:'+str(port)+'/observations/'+row['id'][7:],data=payload,headers={'Content-Type':'application/json'},method='PATCH')
            try:
                with urllib.request.urlopen(req,timeout=8) as response:response.read()
            except (OSError,urllib.error.URLError):raise Failure('Engram debe estar activo en el puerto 7437 para editar. No se escribió la base directamente.',503)
        else:
            p=Path(row['source']);old=p.read_text()
            # Check native file again immediately before replacement.
            if digest(old)!=digest(row['content']) or p.is_symlink() or p.resolve()!=p:raise Failure('El archivo cambió o usa un enlace simbólico',409)
            backup=self.state/'backups';backup.mkdir(exist_ok=True,mode=0o700);prune_backups(backup)
            name=backup/(row['id']+'-'+str(time.time_ns())+'.md');name.write_text(old);os.chmod(name,0o600)
            fd,tmp=tempfile.mkstemp(prefix='.axon-memory-',dir=p.parent)
            try:
                with os.fdopen(fd,'w') as f:f.write(content);f.flush();os.fsync(f.fileno())
                os.chmod(tmp,p.stat().st_mode & 0o777)
                if p.read_text()!=old:raise Failure('El archivo cambió durante el guardado',409)
                os.replace(tmp,p)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
        result=self.memory_detail();result['backup']=str(name)
        return result

def prune_backups(folder, keep=50):
    # Backups grow unboundedly otherwise — keep the newest per rotation.
    try:
        entries=[p for p in Path(folder).iterdir() if not p.is_symlink()]
        for p in sorted(entries,key=lambda x:x.stat().st_mtime,reverse=True)[keep:keep+200]:
            try:p.unlink()
            except OSError:continue
    except OSError:pass

def memory_revision(row):return digest(str(row['updated'])+'\n'+row['title']+'\n'+row['content'])
def file_refs(text):
    text=re.sub(r'[A-Za-z0-9+/=]{8192,}','',text)
    extensions=r'(?:tsx?|jsx?|py|go|rs|md|jsonl?|ya?ml|toml|css|html|sql|sh|txt|xml|svg|png|jpe?g|webp|mp4|pdf|csv|env)'
    # Base64 images contain slash-separated runs too; they are not file paths.
    pattern=r'/(?:home|root|tmp|app|hostfs|etc|var|usr|opt|srv|mnt|media|run|data|workspace|work|Users)(?:/[^\s"\x27<>`{}\[\](),;\\]+)+|(?:[\w.@+-]{1,255}/)+[\w.@+-]{1,255}\.'+extensions+r'\b|\b[\w.-]{1,255}\.'+extensions+r'\b'
    refs={re.sub(r':\d+(?::\d+)?$','',m.rstrip('.,;:')) for m in re.findall(pattern,text) if len(m)<=1024}
    refs.update(m for m in re.findall(r'"(?:file_path|filePath|filename|path)"\s*:\s*"([^"\n]+)"',text) if len(m)<=1024 and (m.startswith('/') or re.search(r'\.'+extensions+r'$',m)))
    return refs

def main():
    request=json.load(sys.stdin)
    if request.get('kind') not in ['chats','memories']:raise Failure('Vista desconocida',404)
    store=Store(request);action=request.get('action')
    if request['kind']=='chats':
        if action=='list':return store.chats()
        if action=='index':return dict(ok=True,pending=store.build_search(),warnings=store.warnings)
        if action=='detail':return store.detail()
        if action=='export':return store.export()
    else:
        if action=='list':return store.memory_list()
        if action=='detail':return store.memory_detail()
        if action=='save':return store.save()
    raise Failure('Operación desconocida',404)

if __name__=='__main__':
    try:print(json.dumps(main(),ensure_ascii=False))
    except Failure as e:print(json.dumps(dict(ok=False,error=str(e),status=e.status)))
    except Exception:print(json.dumps(dict(ok=False,error='No se pudo leer el formato del almacén local',status=503)))
