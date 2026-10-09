/** YouTube only in the MVP (PRD 1.5 #6, 7.3 #9). Returns the 11-character id and an optional start. */
const ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** "90", "90s", "1m30s", "1h2m3s" -> seconds. */
function parseStart(v: string | null): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export function parseYoutube(input: string): { id: string; startSec: number | null } | null {
  const text = input.trim();
  if (ID.test(text)) return { id: text, startSec: null };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | undefined;
  if (url.hostname.toLowerCase() === 'youtu.be') id = parts[0];
  else if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
  else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1];
  if (!id || !ID.test(id)) return null;
  return { id, startSec: parseStart(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}
