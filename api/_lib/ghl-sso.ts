import type { OperatorClaims } from './operator-auth';

/**
 * HighLevel hands an embedded app its user context as an OpenSSL-compatible
 * AES-256-CBC payload keyed by the app's shared secret, so decrypting it is
 * what proves the browser is really inside the agency's dashboard.
 */
export interface GhlUserContext {
  userId: string;
  companyId: string;
  role: string;
  type: 'agency' | 'location';
  activeLocation?: string;
  userName?: string;
  email?: string;
}

export interface GhlSsoConfig {
  sharedSecret: string;
  location: string;
  todd: string;
  ty: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** OpenSSL derives the key and IV from the passphrase and salt by chained MD5. */
function evpBytesToKey(passphrase: Uint8Array, salt: Uint8Array, byteCount: number): Uint8Array {
  const derived = new Uint8Array(byteCount);
  let previous = new Uint8Array(0);
  let filled = 0;
  while (filled < byteCount) {
    const input = new Uint8Array(previous.length + passphrase.length + salt.length);
    input.set(previous, 0);
    input.set(passphrase, previous.length);
    input.set(salt, previous.length + passphrase.length);
    previous = md5(input);
    const take = Math.min(previous.length, byteCount - filled);
    derived.set(previous.subarray(0, take), filled);
    filled += take;
  }
  return derived;
}

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_SINES = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));

/** Web Crypto has no MD5 and OpenSSL's key derivation requires it. */
function md5(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) << 6);
  padded.set(input, 0);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 4294967296), true);

  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const words = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(chunk + i * 4, true);
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + MD5_SINES[i] + words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << MD5_SHIFTS[i]) | (sum >>> (32 - MD5_SHIFTS[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const digest = new Uint8Array(16);
  new DataView(digest.buffer).setUint32(0, a0, true);
  new DataView(digest.buffer).setUint32(4, b0, true);
  new DataView(digest.buffer).setUint32(8, c0, true);
  new DataView(digest.buffer).setUint32(12, d0, true);
  return digest;
}

function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

/** Returns null for anything that does not decrypt to a HighLevel user context. */
export async function decryptGhlUserContext(
  encryptedData: unknown,
  sharedSecret: string,
): Promise<GhlUserContext | null> {
  if (typeof encryptedData !== 'string' || !encryptedData || !sharedSecret) return null;
  const raw = fromBase64(encryptedData);
  if (!raw || raw.length <= 16 || decoder.decode(raw.subarray(0, 8)) !== 'Salted__') return null;
  const salt = raw.subarray(8, 16);
  const derived = evpBytesToKey(encoder.encode(sharedSecret), salt, 48);
  try {
    const key = await crypto.subtle.importKey('raw', derived.subarray(0, 32), { name: 'AES-CBC' }, false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: derived.subarray(32, 48) },
      key,
      raw.subarray(16),
    );
    const parsed = JSON.parse(decoder.decode(new Uint8Array(plaintext))) as GhlUserContext;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.userId !== 'string' || !parsed.userId) return null;
    return parsed;
  } catch { return null; }
}

export function parseGhlSsoConfig(env: NodeJS.ProcessEnv = process.env): GhlSsoConfig {
  const sharedSecret = env.GHL_APP_SHARED_SECRET?.trim() ?? '';
  const location = env.GHL_LOCATION_ID?.trim() ?? '';
  const todd = env.GHL_SSO_TODD_USER_ID?.trim() ?? '';
  const ty = env.GHL_SSO_TY_USER_ID?.trim() ?? '';
  if (!sharedSecret || !location || (!todd && !ty) || (todd && todd === ty)) {
    throw new Error('HighLevel SSO is not configured');
  }
  return { sharedSecret, location, todd, ty };
}

/**
 * Only the two mapped HighLevel users get a session, and only from the Abrams
 * sub-account — another location in the same agency is not an operator here.
 */
export function resolveOperatorFromGhlUser(
  context: GhlUserContext | null,
  config: GhlSsoConfig,
): OperatorClaims['sub'] | null {
  if (!context) return null;
  if (context.activeLocation !== config.location) return null;
  if (config.todd && context.userId === config.todd) return 'todd';
  if (config.ty && context.userId === config.ty) return 'ty';
  return null;
}
