import { Env } from "../env";

export async function handleConnectionsApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/connections/google_drive/auth") {
    const clientId = env.GOOGLE_CLIENT_ID;
    if (!clientId) return new Response(JSON.stringify({ error: "Google Client ID not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
    const redirectUri = `${env.DASHBOARD_ORIGIN}/oauth/callback/google_drive`;
    const scope = encodeURIComponent("https://www.googleapis.com/auth/drive.file");
    const state = crypto.randomUUID();
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    
    return new Response(JSON.stringify({ url: authUrl, state }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  if (request.method === "POST" && path === "/api/connections/google_drive/callback") {
    const body = await request.json() as { code: string; redirectUri: string };
    const { code, redirectUri } = body;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      })
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      return new Response(JSON.stringify({ error: "Failed to exchange token: " + err }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const tokens = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in: number };
    
    const secretBytes = new TextEncoder().encode((env.SESSION_SIGNING_SECRET || "default_secret").padEnd(32, '0').slice(0, 32));
    const secretKey = await crypto.subtle.importKey("raw", secretBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
    
    async function encrypt(text: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(text);
      const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, encoded);
      return btoa(String.fromCharCode(...iv)) + ":" + btoa(String.fromCharCode(...new Uint8Array(encrypted)));
    }

    const encAccess = await encrypt(tokens.access_token);
    const encRefresh = tokens.refresh_token ? await encrypt(tokens.refresh_token) : null;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const connectionId = "conn_google_drive";
    
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO channel_connections (id, provider, connection_type, status, capabilities_json) 
        VALUES (?, 'Google Drive', 'warehouse', '["storage"]', 'connected')
        ON CONFLICT(id) DO UPDATE SET status = 'connected', updated_at = datetime('now')
      `).bind(connectionId),
      env.DB.prepare(`
        INSERT INTO connection_secrets (connection_id, encrypted_access_token, encrypted_refresh_token, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET 
          encrypted_access_token = excluded.encrypted_access_token, 
          encrypted_refresh_token = COALESCE(excluded.encrypted_refresh_token, connection_secrets.encrypted_refresh_token), 
          expires_at = excluded.expires_at, 
          updated_at = datetime('now')
      `).bind(connectionId, encAccess, encRefresh, expiresAt)
    ]);

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" }});
  }
  
  if (request.method === "POST" && path === "/api/connections/google_drive/disconnect") {
    const connectionId = "conn_google_drive";
    await env.DB.batch([
      env.DB.prepare("UPDATE channel_connections SET status = 'not_connected', updated_at = datetime('now') WHERE id = ?").bind(connectionId),
      env.DB.prepare("DELETE FROM connection_secrets WHERE connection_id = ?").bind(connectionId)
    ]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" }});
  }

  return null;
}
