# Jarvis V1 architecture

```text
Cloudflare Cron (hourly)
        |
        v
Worker heartbeat -> D1 job lock -> Scout executor
        |                              |
        |                              v
        |                      zero-spend guard
        |                              |
        |                    NVIDIA or local fixture
        |                              |
        |                    Zod schema validation
        |                              |
        +----------------------> D1 opportunity
                                       |
React Founder HQ <--- authenticated API+
```

## Reliability model

Workers remain stateless. D1 stores jobs, locks, attempts, agent runs, decisions, rules, learnings, resources, reports, and venture state. Each hourly invocation acquires at most one due job. Failures retry with bounded exponential delay; provider calls blocked by the cost guard are deferred without consuming an attempt.

## Trust boundaries

- AI output is untrusted until Zod validation succeeds.
- Opportunity scores are deterministic; the model cannot change weights.
- High competition and build effort reduce the score.
- Missing credible linked evidence keeps an opportunity in `researching`.
- Production API access fails closed without a Founder token.
- Consumer Gemini/Flow subscriptions are represented as manual resources only.
- Keys are Worker secrets and never frontend values.

## Current stage boundary

Deep-research requests create executable Strategist jobs. The Learning Engine reviews completed experiments that do not yet have a learning, and the deterministic Daily Report job produces an executive brief without spending AI allowance. NVIDIA-dependent jobs still defer safely when the key or explicit free-allowance confirmation is absent.
