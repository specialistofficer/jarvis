import type { Env } from "./env";
import { runHeartbeat } from "./jobs/runner";
import { handleApi } from "./routes/api";
import { verifySessionToken } from "./auth";
import { handleMediaPublicRoute } from "./mediaRoutes";
import { handleConnectionsApi } from "./routes/connections";

function applyCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get("origin");
  const allowed = new Set([env.DASHBOARD_ORIGIN, "http://localhost:5173"]);
  if (!origin || !allowed.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Dev-Token");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return applyCors(new Response(null, { status: 204 }), request, env);
    const path = new URL(request.url).pathname;
    const mediaResponse = await handleMediaPublicRoute(request, env);
    if (mediaResponse) return applyCors(mediaResponse, request, env);
    const isPublic = path === "/api/health" || path === "/api/auth/login" || path === "/api/system/trigger_heartbeat";
    if (env.ENVIRONMENT === "production" && !isPublic) {
      const authorization = request.headers.get("authorization") ?? "";
      const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const sessionValid = bearer ? await verifySessionToken(env, bearer) : false;
      if (!sessionValid) {
        return applyCors(Response.json({ error: "Founder authentication required" }, { status: 401 }), request, env);
      }
    }
    const connectionsResponse = await handleConnectionsApi(request, env);
    if (connectionsResponse) return applyCors(connectionsResponse, request, env);
    const response = await handleApi(request, env);
    return applyCors(response, request, env);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runHeartbeat(env).catch((error) => {
      console.error(JSON.stringify({ event: "heartbeat_error", error: error instanceof Error ? error.message : String(error) }));
    }));
  },
} satisfies ExportedHandler<Env>;
