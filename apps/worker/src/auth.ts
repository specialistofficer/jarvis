import type { Env } from "./env";

const encoder = new TextEncoder();

function toBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeEqual(left: string, right: string): boolean {
  const max = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < max; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(password));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function founderEmail(env: Env): string | undefined {
  return env.FOUNDER_EMAIL_SECRET ?? env.FOUNDER_EMAIL;
}

export async function validateFounderCredentials(env: Env, email: string, password: string): Promise<boolean> {
  const configuredEmail = founderEmail(env);
  if (!configuredEmail || !env.FOUNDER_PASSWORD_HASH) return false;
  const candidateHash = await hashPassword(password);
  return safeEqual(email.trim().toLowerCase(), configuredEmail.toLowerCase()) && safeEqual(candidateHash, env.FOUNDER_PASSWORD_HASH);
}

export async function createSessionToken(env: Env, email: string): Promise<string> {
  if (!env.SESSION_SIGNING_SECRET) throw new Error("Session signing secret is not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({ sub: email.toLowerCase(), iat: now, exp: now + 60 * 60 * 24 * 7 }));
  const input = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env.SESSION_SIGNING_SECRET), encoder.encode(input)));
  return `${input}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(env: Env, token: string): Promise<boolean> {
  const configuredEmail = founderEmail(env);
  if (!env.SESSION_SIGNING_SECRET || !configuredEmail) return false;
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return false;
  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await signingKey(env.SESSION_SIGNING_SECRET),
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
    );
    if (!verified) return false;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { sub?: string; exp?: number };
    return claims.sub === configuredEmail.toLowerCase() && typeof claims.exp === "number" && claims.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
