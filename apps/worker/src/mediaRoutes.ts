import type { Env } from "./env";

interface GithubClaims { aud?: string; exp?: number; repository?: string; ref?: string; event_name?: string }
interface GithubJwk extends JsonWebKey { kid?: string }
let githubKeys: { keys: GithubJwk[]; loadedAt: number } | null = null;

function decodeSegment(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(normalized); const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function verifyGithubOidc(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeSegment(parts[0]))) as { kid?: string; alg?: string };
    const claims = JSON.parse(new TextDecoder().decode(decodeSegment(parts[1]))) as GithubClaims;
    if (header.alg !== "RS256" || !header.kid || claims.aud !== "jarvis-media-renderer"
      || claims.repository !== "specialistofficer/jarvis" || claims.ref !== "refs/heads/main"
      || !claims.exp || claims.exp * 1000 <= Date.now()) return false;
    if (!githubKeys || Date.now() - githubKeys.loadedAt > 3_600_000) {
      const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks");
      if (!response.ok) return false;
      const body = await response.json<{ keys: GithubJwk[] }>();
      githubKeys = { keys: body.keys, loadedAt: Date.now() };
    }
    const jwk = githubKeys.keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signature = decodeSegment(parts[2]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature.buffer as ArrayBuffer, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch { return false; }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleMediaPublicRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname;
  const contentMatch = path.match(/^\/media\/([a-f0-9-]+)$/i);
  if ((request.method === "GET" || request.method === "HEAD") && contentMatch?.[1]) {
    const row = await env.DB.prepare("SELECT storage_key, format FROM media_assets WHERE public_id = ? AND storage_key IS NOT NULL AND status != 'deleted'")
      .bind(contentMatch[1]).first<{ storage_key: string; format: string }>();
    if (!row) return new Response("Media not found", { status: 404 });
    const object = await env.MEDIA.get(row.storage_key);
    if (!object) return new Response("Media object missing", { status: 404 });
    const headers = new Headers({ "Content-Type": row.format, "Cache-Control": "public, max-age=31536000, immutable", ETag: object.httpEtag });
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }

  if (path === "/api/media/renderer/claim" && request.method === "POST") {
    if (!await verifyGithubOidc(request)) return json({ error: "Valid specialistofficer/jarvis GitHub OIDC token required" }, 401);
    await env.DB.prepare("UPDATE media_assets SET status = 'render_queued', lease_until = NULL, last_error = 'Recovered expired renderer lease', updated_at = datetime('now') WHERE status = 'rendering' AND lease_until <= datetime('now')").run();
    const task = await env.DB.prepare(`UPDATE media_assets SET status = 'rendering', lease_until = datetime('now', '+25 minutes'),
      render_attempts = render_attempts + 1, updated_at = datetime('now') WHERE id = (
        SELECT id FROM media_assets WHERE status = 'render_queued' AND render_attempts < 3 ORDER BY created_at ASC LIMIT 1
      ) AND status = 'render_queued' RETURNING id, media_kind, format, width, height, duration_seconds, spec_json`)
      .first<Record<string, unknown>>();
    return json({ task: task ?? null });
  }

  const uploadMatch = path.match(/^\/api\/media\/renderer\/([a-f0-9-]+)\/upload$/i);
  if (uploadMatch?.[1] && request.method === "POST") {
    if (!await verifyGithubOidc(request)) return json({ error: "Valid GitHub OIDC token required" }, 401);
    const type = request.headers.get("content-type")?.split(";")[0] ?? "";
    if (!new Set(["image/png", "video/mp4"]).has(type)) return json({ error: "Only PNG and MP4 outputs are accepted" }, 415);
    const media = await env.DB.prepare("SELECT id, media_kind FROM media_assets WHERE id = ? AND status = 'rendering'")
      .bind(uploadMatch[1]).first<{ id: string; media_kind: string }>();
    if (!media) return json({ error: "Active render lease not found" }, 409);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 30 * 1024 * 1024) return json({ error: "Media output must be between 1 byte and 30 MB" }, 413);
    const usage = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) total FROM media_assets WHERE status != 'deleted'").first<{ total: number }>();
    if (Number(usage?.total ?? 0) + bytes.byteLength > 8 * 1024 * 1024 * 1024) return json({ error: "Jarvis 8 GB zero-spend storage guard reached" }, 507);
    const expected = media.media_kind === "video" ? "video/mp4" : "image/png";
    if (type !== expected) return json({ error: `Expected ${expected}` }, 400);
    const key = `generated/${media.id}.${media.media_kind === "video" ? "mp4" : "png"}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
    await env.DB.prepare("UPDATE media_assets SET status = 'ready_for_review', storage_key = ?, format = ?, bytes = ?, lease_until = NULL, completed_at = datetime('now'), updated_at = datetime('now'), last_error = NULL WHERE id = ?")
      .bind(key, type, bytes.byteLength, media.id).run();
    return json({ ok: true, id: media.id, bytes: bytes.byteLength });
  }

  const failMatch = path.match(/^\/api\/media\/renderer\/([a-f0-9-]+)\/fail$/i);
  if (failMatch?.[1] && request.method === "POST") {
    if (!await verifyGithubOidc(request)) return json({ error: "Valid GitHub OIDC token required" }, 401);
    const body = await request.json().catch(() => ({})) as { error?: string };
    await env.DB.prepare(`UPDATE media_assets SET status = CASE WHEN render_attempts >= 3 THEN 'failed' ELSE 'render_queued' END,
      lease_until = NULL, last_error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'rendering'`)
      .bind(String(body.error ?? "Renderer failed").slice(0, 1200), failMatch[1]).run();
    return json({ ok: true });
  }
  return null;
}
