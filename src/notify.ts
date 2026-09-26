// Generic outbound notifications — ntfy.sh, Gotify, Discord webhooks.
// Configured via settings.notifyUrl; silently no-ops when unset.
let webhookUrl = '';

export function setNotifyUrl(url?: string): void {
  webhookUrl = (url || '').trim();
}

export function notifyConfigured(): boolean {
  return webhookUrl.length > 0;
}

export async function notify(title: string, body: string, priority = 3): Promise<void> {
  if (!webhookUrl) return;
  try {
    const isDiscord = webhookUrl.includes('discord.com') || webhookUrl.includes('discordapp.com');
    const isGotify = /gotify/.test(webhookUrl);
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
      // ntfy + generic JSON consumers
      init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Title: title, Priority: String(priority) },
        body: JSON.stringify({ title, body }),
      };
    }
    await fetch(webhookUrl, { ...init, signal: AbortSignal.timeout(8000) });
  } catch { /* notification delivery is best-effort */ }
}
