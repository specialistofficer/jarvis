# Live deployment

- Founder HQ: https://jarvis-founder-hq.pages.dev
- Worker API: https://jarvis-api.chiragsharma376.workers.dev
- D1 database: `jarvis-db` (`cbe8c557-60f7-4378-8757-14a4bb7da95f`, APAC)
- Cron: hourly at `0 * * * *` (UTC)
- Cloudflare Pages project: `jarvis-founder-hq`
- Cloudflare Worker: `jarvis-api`

Production is fail-closed behind the single-founder email/password login. Cloudflare stores `FOUNDER_EMAIL_SECRET`, `FOUNDER_PASSWORD_HASH`, and `SESSION_SIGNING_SECRET` as Worker secrets; authenticated browser sessions expire after seven days. The NVIDIA secret is configured and the founder confirmed remaining free allowance on 2026-08-20. The live provider is `meta/llama-3.1-8b-instruct`; Scout and Strategist calls have both passed schema validation and persisted audited results. Daily reports and no-op learning reviews can run without an AI call.

Founder HQ is assistant-first and installable as a PWA. Text chat works in all supported browsers; voice input uses the browser Speech Recognition capability when available, with a permanent typed fallback. Assistant mutations are stored as expiring proposals and execute only after an authenticated confirmation.

Dashboard deployments must be built with:

```text
VITE_API_BASE_URL=https://jarvis-api.chiragsharma376.workers.dev
```
