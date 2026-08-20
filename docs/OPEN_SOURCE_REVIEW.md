# Open-source review

Reviewed on 2026-08-20 before implementation.

## Adopted as reference patterns

### Cloudflare official React starter

- Repository: https://github.com/cloudflare/templates/tree/main/react-starter-template
- Why: official React + Vite + TypeScript + Workers baseline, current Cloudflare deployment patterns, minimal assumptions.
- Decision: use the platform pattern, not copy the repository wholesale. Jarvis keeps separate dashboard and Worker workspaces because its requested deployment boundary is Pages + Worker.

### Cloudflare D1 and Cron documentation

- Cron: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
- Decision: one hourly trigger and a persistent D1 queue rather than many cron triggers or a continuously running process.

## Reviewed but not adopted

### AgentOS

- Repository: https://github.com/SapienXai/AgentOS
- License: MIT at review time.
- Reason not adopted: centered on operating teams of general digital workers through OpenClaw. Jarvis V1 needs a much smaller evidence/scoring/job vertical slice on Cloudflare.

### OneManCompany

- Repository: https://github.com/1mancompany/OneManCompany
- Reason not adopted: hierarchical AI-company runtime and agent communication are deliberately outside Jarvis V1's six logical roles plus one orchestrator constraint.

### OpenCognit Community Edition

- Repository: https://github.com/OpenCognit/opencognit
- License/status: AGPL-3.0 community release; repository states active development moved to a commercial edition and the community edition is unmaintained.
- Reason not adopted: license obligations, maintenance status, self-hosted server architecture, and broad agent runtime do not match the focused Cloudflare/free-tier V1.

### Third-party Cloudflare starters

- Examples reviewed: cloudflare-workers-react-boilerplate and cloudflare-template-app.
- Useful ideas: same-origin APIs, Worker-runtime testing, explicit secrets, and simple SPA navigation.
- Reason not adopted wholesale: some include unrelated billing/auth/AI choices, and the official Cloudflare baseline minimizes inherited code and supply-chain surface.

## Reuse rule

Jarvis may reuse a small external component only after checking its license, maintenance activity, Worker compatibility, dependency weight, and whether it preserves the hard ₹0 policy. References and concepts are preferred over importing an entire agent framework.
