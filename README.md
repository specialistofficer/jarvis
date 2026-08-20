# Jarvis

Jarvis is a zero-spend autonomous venture and growth operating system. This repository contains the first working vertical slice: a scheduled Cloudflare Worker, persistent D1 memory, an NVIDIA-compatible Scout, deterministic opportunity scoring, and a mobile-first Founder HQ.

Jarvis now presents the operating system through a private text/voice founder assistant. The assistant explains live state and can propose a limited set of actions, but every mutation requires explicit founder confirmation. Opportunities remain in `researching` when credible linked evidence is missing.

Live Founder HQ: https://jarvis-founder-hq.pages.dev

## What works now

- Hourly Cloudflare Cron heartbeat with a persistent D1 job queue
- Safe single-job acquisition, bounded retries, deferral, and structured audit logs
- NVIDIA provider behind a generic `AIProvider` interface
- Zod validation before any AI output reaches D1
- Hard zero-spend guard (`ALLOW_PAID_SPEND=false`, `MAX_COST_INR=0`)
- Deterministic scoring with fixed weights and inverted competition/build-effort inputs
- Duplicate detection using normalized fingerprints and Jaccard similarity
- ClothMatics seed venture plus a generic venture/project schema
- Founder actions: Promote, Reject, Deep Research, and Mark Duplicate
- Founder rules, resources, jobs, decisions, learnings, reports, and agent-run storage
- Master pause/resume control
- Strategist deep-research jobs with founder rules and prior learning retrieval
- Learning extraction from completed experiment prediction-versus-result data
- Deterministic daily executive reports that do not consume AI allowance
- Responsive React Founder HQ with an installable PWA shell
- Browser voice input and spoken replies with typed-chat fallback
- Persistent assistant conversation and confirmation-gated action proposals
- Single-founder email/password login with rate limiting and signed sessions
- Production authentication fails closed when founder secrets are missing

The local mock Scout is a pipeline fixture, not market evidence. Its output is deliberately low-confidence and remains `researching`.

## Repository layout

```text
apps/
  dashboard/       React + TypeScript + Vite Founder HQ
  worker/          Cloudflare Worker, API, scheduler, jobs, AI providers
packages/
  ai/              Provider interface
  scoring/         Deterministic opportunity scoring
  shared/          Cost policy and duplicate utilities
  types/           Shared Zod schemas and API types
migrations/        D1 schema and seed data
docs/              Architecture and open-source review
tests/             Deterministic foundation tests
```

## Local setup

Prerequisite: Node.js 22 or newer.

```powershell
npm install
Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars
npm run db:migrate:local
```

The example `.dev.vars` enables the deterministic development fixture. Choose a private `DEV_TRIGGER_TOKEN` before starting.

Start the Worker and dashboard in separate terminals:

```powershell
npm run dev:worker
```

```powershell
npm run dev:dashboard
```

Open `http://localhost:5173`.

Do not double-click `apps/dashboard/index.html`; it is a Vite source entry, not a standalone page. On Windows you can instead double-click `apps/dashboard/start-dashboard.cmd`.

Trigger the local Scout manually:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8787/api/dev/run-scout `
  -Headers @{ 'x-dev-token' = 'your-private-local-token' }
```

To test a real NVIDIA call, edit `apps/worker/.dev.vars`:

```text
NVIDIA_API_KEY=your-key
DEV_MOCK_AI=false
NVIDIA_FREE_ALLOWANCE_REMAINING=true
```

Only set the allowance flag while the NVIDIA account actually shows remaining free allowance. If the key or explicit allowance confirmation is absent, Jarvis defers the job instead of calling the provider.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

Test the scheduled handler locally while Wrangler is running:

```powershell
Invoke-WebRequest http://127.0.0.1:8787/cdn-cgi/local/scheduled
```

## Cloudflare deployment

No paid service is required, but check current free-tier limits in your own Cloudflare and NVIDIA accounts before enabling autonomous calls.

1. Authenticate and create the production D1 database.

   ```powershell
   npx wrangler login
   npx wrangler d1 create jarvis-db
   ```

2. Replace the placeholder `database_id` in the `env.production` D1 binding inside `apps/worker/wrangler.jsonc` with the returned UUID.

3. Change `env.production.vars.DASHBOARD_ORIGIN` in `apps/worker/wrangler.jsonc` to the exact production `https://<project>.pages.dev` origin.

4. Apply migrations and store secrets. Never put either value in Git.

   ```powershell
   npm run db:migrate:remote
   npx wrangler secret put NVIDIA_API_KEY --env production --config apps/worker/wrangler.jsonc
   npx wrangler secret put FOUNDER_EMAIL_SECRET --env production --config apps/worker/wrangler.jsonc
   npx wrangler secret put FOUNDER_PASSWORD_HASH --env production --config apps/worker/wrangler.jsonc
   npx wrangler secret put SESSION_SIGNING_SECRET --env production --config apps/worker/wrangler.jsonc
   ```

   Use a long, random Founder token. The production API returns `503` when the token is not configured and `401` when it is not supplied.

5. Deploy the Worker.

   ```powershell
   npm run deploy --workspace=@jarvis/worker
   ```

6. In Cloudflare Pages, import the GitHub repository with:

   - Root directory: repository root
   - Build command: `npm run build --workspace=@jarvis/dashboard`
   - Build output directory: `apps/dashboard/dist`
   - Environment variable: `VITE_API_BASE_URL=https://<jarvis-worker>.workers.dev`

7. Open Founder HQ and enter the Founder token. It is stored only in that browser's session storage, not in the frontend bundle.

8. Keep `NVIDIA_FREE_ALLOWANCE_REMAINING=false` until allowance is explicitly verified. Change it through the Worker environment only for the confirmed free window.

## Security boundary

The bearer gate is a safe V1 founder-only boundary and an abstraction point for Firebase Authentication. Before sharing Founder HQ with multiple users, replace it with server-verified Firebase ID tokens and access rules. `POST /api/dev/run-scout` is disabled whenever `ENVIRONMENT=production`.

## Next implementation stage

The next slice is stronger external evidence collection, experiment result capture, richer report rendering, and Firebase Authentication. Automatic publishing, production releases, spending, and browser automation against consumer subscriptions remain explicitly out of scope.
