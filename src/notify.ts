// Generic outbound notifications — ntfy.sh, Gotify, Discord webhooks.
// Configured via settings.notifyUrl; silently no-ops when unset.
let webhookUrl = '';
let provider = 'auto';

export function setNotifyUrl(url?: string, kind = 'auto'): void {
  webhookUrl = (url || '').trim();
  provider = kind;
}

export function notifyConfigured(): boolean {
  return webhookUrl.length > 0;
}

export async function notify(title: string, body: string, priority = 3, strict = false): Promise<void> {
  if (!webhookUrl) return;
  try {
    const hostname = new URL(webhookUrl).hostname;
    const isDiscord = provider === 'discord' || provider === 'auto' && (['discord.com', 'discordapp.com'].includes(hostname) || hostname.endsWith('.discord.com'));
    const isGotify = provider === 'gotify' || provider === 'auto' && /gotify/.test(hostname);
    let init: RequestInit;
    if (isDiscord) {
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `**${title}**\n${body}` }),
      };
    } else if (isGotify) {
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message: body, priority }),
      };
    } else {
      // ntfy topic endpoint, including servers with a custom hostname.
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8', Title: `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`, Priority: String(priority) },
        body,
      };
    }
    const response = await fetch(webhookUrl, { ...init, signal: AbortSignal.timeout(8000) });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`El webhook respondió HTTP ${response.status}`);
  } catch (e) { if (strict) throw new Error('No se pudo entregar la notificación: ' + (e as Error).message); }
}
