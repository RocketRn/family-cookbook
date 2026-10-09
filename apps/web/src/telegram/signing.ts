/**
 * Development-only initData signer (WebCrypto). The mock provider signs a FRESH initData at every
 * app start with the fake dev token, so it never goes stale (the API enforces a 24 h auth_date window).
 * Same algorithm as the server validator: docs/DECISIONS.md D-006.
 */
const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function signInitData(
  fields: Record<string, string>,
  botToken: string,
): Promise<string> {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = await hmac(enc.encode('WebAppData'), botToken);
  const hash = toHex(await hmac(secret, dataCheckString));
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}
