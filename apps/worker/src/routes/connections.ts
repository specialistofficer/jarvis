import { Env } from "../env";

export async function handleConnectionsApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const matchAuth = path.match(/^\/api\/connections\/([a-z_]+)\/auth$/);
  if (request.method === "GET" && matchAuth) {
    const provider = matchAuth[1];
    let authUrl = "";
    
    if (provider === "google_drive" || provider === "youtube") {
      const clientId = env.GOOGLE_CLIENT_ID;
      if (!clientId) return new Response(JSON.stringify({ error: "Google Client ID not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
      const redirectUri = `${env.DASHBOARD_ORIGIN}/oauth/callback/${provider}`;
      const scopes = provider === "google_drive" 
        ? "https://www.googleapis.com/auth/drive.file" 
        : "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly";
      const state = crypto.randomUUID();
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}&access_type=offline&prompt=consent&state=${state}`;
    } else if (provider === "instagram") {
      const clientId = env.META_CLIENT_ID;
      if (!clientId) return new Response(JSON.stringify({ error: "Meta Client ID not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
      const redirectUri = `${env.DASHBOARD_ORIGIN}/oauth/callback/${provider}`;
      const scopes = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_show_list,pages_read_engagement";
      const state = crypto.randomUUID();
      authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${encodeURIComponent(scopes)}&response_type=code`;
    } else if (provider === "linkedin" || provider === "x") {
      return new Response(JSON.stringify({ error: `Provider ${provider} not fully implemented yet` }), { status: 501, headers: { "Content-Type": "application/json" } });
    } else {
      return new Response(JSON.stringify({ error: "Unknown provider" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    
    return new Response(JSON.stringify({ url: authUrl }), { headers: { "Content-Type": "application/json" } });
  }

  const matchCallback = path.match(/^\/api\/connections\/([a-z_]+)\/callback$/);
  if (request.method === "POST" && matchCallback) {
    const provider = matchCallback[1];
    const body = await request.json() as { code: string; redirectUri: string };
    const { code, redirectUri } = body;

    let tokens: any = {};
    if (provider === "google_drive" || provider === "youtube") {
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
      if (!tokenResponse.ok) return new Response(JSON.stringify({ error: "Token exchange failed: " + await tokenResponse.text() }), { status: 400, headers: { "Content-Type": "application/json" } });
      tokens = await tokenResponse.json();
    } else if (provider === "instagram") {
      const tokenResponse = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${env.META_CLIENT_ID}&redirect_uri=${redirectUri}&client_secret=${env.META_CLIENT_SECRET}&code=${code}`, {
        method: "GET"
      });
      if (!tokenResponse.ok) return new Response(JSON.stringify({ error: "Token exchange failed: " + await tokenResponse.text() }), { status: 400, headers: { "Content-Type": "application/json" } });
      tokens = await tokenResponse.json();
      
      // Meta provides long-lived tokens via a separate endpoint if needed, but for now we'll just store the short-lived/long-lived token returned.
      // Typical response: { access_token: "...", token_type: "bearer", expires_in: 5183999 }
      if (!tokens.refresh_token) tokens.refresh_token = null; 
    } else {
      return new Response(JSON.stringify({ error: "Not implemented" }), { status: 501, headers: { "Content-Type": "application/json" } });
    }

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
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
    const connectionId = `conn_${provider}`;
    const providerName = provider === "google_drive" ? "Google Drive" : provider === "youtube" ? "YouTube" : provider === "instagram" ? "Instagram" : provider;
    const connectionType = provider === "google_drive" ? "warehouse" : "channel";
    const caps = provider === "google_drive" ? '["storage"]' : '["publish", "analytics"]';
    
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO channel_connections (id, provider, connection_type, status, capabilities_json) 
        VALUES (?, ?, ?, 'connected', ?)
        ON CONFLICT(id) DO UPDATE SET status = 'connected', updated_at = datetime('now')
      `).bind(connectionId, providerName, connectionType, caps),
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
  
  const matchDisconnect = path.match(/^\/api\/connections\/([a-z_]+)\/disconnect$/);
  if (request.method === "POST" && matchDisconnect) {
    const provider = matchDisconnect[1];
    const connectionId = `conn_${provider}`;
    await env.DB.batch([
      env.DB.prepare("UPDATE channel_connections SET status = 'not_connected', updated_at = datetime('now') WHERE id = ?").bind(connectionId),
      env.DB.prepare("DELETE FROM connection_secrets WHERE connection_id = ?").bind(connectionId)
    ]);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" }});
  }

  return null;
}
