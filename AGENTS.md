# AGENTS.md — System Operating & Engineering Rules

This document specifies the mandatory engineering, safety, architectural, and behavioral rules for all human and autonomous AI agents contributing to the **Personal AI Client Acquisition Agent** and the **Jarvis** ecosystem.

---

## 1. Project & Founder Directives

1. **Founder Profile:**
   - The founder and owner is Chirag.
   - Values **measurable outcomes**, clean code, and factual truth over activity metrics or simulated busywork.
   - Prefers concise explanations (Hinglish/English) with visible evidence.

2. **Core Mission:**
   - Find high-relevance, paid freelance and contract software development opportunities across multiple vetted sources.
   - Accurately evaluate opportunities against the owner's genuine 10-year engineering skill set (Java/Spring enterprise systems, React web apps, production Android apps on Google Play, and AI integration).
   - Prepare hyper-personalized, solution-oriented proposals.
   - Keep the owner fully in control through interactive Telegram notifications and a responsive React dashboard.

3. **Absolute Ground Rule:**
   - **Zero Factual Invention:** Never invent experience, past clients, certifications, revenue numbers, employers, technologies, case studies, or project outcomes. The agent may only cite facts explicitly recorded in the owner profile and portfolio.

---

## 2. Safety & Compliance Rules

1. **Platform Terms Compliance:**
   - Every integration source must possess an explicit `SourceCapability` definition.
   - If a platform disallows headless browser automation or automated proposal submission:
     - The agent **MUST NOT** attempt to bypass anti-bot systems, solve CAPTCHAs, or violate terms.
     - The agent **MUST** execute the *Manual Review* flow: collect the job, score it, prepare the proposal, generate the official application URL, and alert the owner for 1-click manual submission.
   - Mass-messaging, spamming, and generic spray-and-pray applications are strictly prohibited.

2. **Human-in-the-Loop Safeguards:**
   - Default system mode is `APPROVAL_REQUIRED`.
   - No proposal or message may be sent to an external client or marketplace without explicit founder confirmation via Telegram or Dashboard.
   - Autonomous submission (`AUTO` mode) is disabled by default and may only activate for explicitly whitelisted sources under strict rule verification.

3. **Cost & Secret Safeguards:**
   - `ALLOW_PAID_SPEND=false` / strict budget caps on API usage.
   - Application costs (Upwork connects, platform credits) must be calculated prior to proposing an application.
   - Never print, log, or commit API keys, tokens, session cookies, or passwords. All secrets are loaded from environment variables (`.env`).

---

## 3. AI Engineering Rules

1. **Provider Abstraction:**
   - AI interactions must be routed through the `AIProvider` abstract interface (`generate`, `structured_output`, `classify`, `embed`).
   - Primary model provider: **Google Gemini** (via official SDK).
   - Fallback providers: **NVIDIA API** / configured OpenAI-compatible endpoints.

2. **Factual Verification Gate (Mandatory):**
   - Every generated proposal or outreach message must pass an independent automated validation check against the owner's profile before being shown to the founder or queued for sending.
   - The validation check scans for:
     - Unverified company/client names.
     - Unsubstantiated metrics (e.g., "boosted revenue by 400%").
     - Technologies not present in the owner profile.
     - Unsupported timeline or availability guarantees.
   - If an unsupported claim is detected, the draft is rejected and regenerated or flagged for manual editing.

3. **Anti-Hallucination & Model Routing:**
   - Use small, fast models for filtering, deduplication, and initial classification.
   - Use high-reasoning models with structured schemas for deep job analysis, portfolio matching, and proposal generation.
   - Never accept unstructured text when structured JSON or Pydantic models are required.

---

## 4. Coding & Architecture Standards

1. **Backend (Python / FastAPI):**
   - Python $\ge$ 3.11.
   - Strict static type hints throughout (`mypy` / `pyright` compliant).
   - Pydantic v2 for all schemas, DTOs, and configuration settings.
   - SQLAlchemy / SQLModel with asynchronous database sessions.
   - Async-first I/O for all HTTP, database, and browser calls.
   - Meaningful structured logging with correlation IDs.

2. **Frontend (React 19 + TypeScript + Vite):**
   - Type-safe API communication.
   - Outcome-oriented views: Opportunities, Applications, Analytics, Strategy, Portfolio, and Settings.
   - Mobile-first, responsive design with clear status badges and action controls.

3. **Platform Adapters:**
   - Standardized adapter interface: `search()`, `fetch_details()`, `can_apply()`, `submit_application()`.
   - Resilient retry logic with exponential backoff and jitter.
   - Rate limiters per domain/source to prevent throttling.

---

## 5. Testing & Verification Rules

1. **Test-First Rigor:**
   - Any new agent module or adapter must have accompanying unit and integration tests.
   - Critical test suites:
     - Deduplication and fingerprint generation.
     - Scoring formula and economics calculations.
     - Portfolio semantic and tag matching.
     - Factual validation rejection of fabricated claims.
     - Telegram webhook and callback query handling.
     - Source capability enforcement (blocking auto-submit on restricted platforms).
2. **Mocking External Services:**
   - Unit tests must never call live marketplace APIs or send live Telegram messages.
   - Use mock adapters and recorded fixtures for external platforms.
3. **Verification Before Completion:**
   - No task is marked complete without clean automated test runs (`pytest`, `npm test`, `npm run typecheck`).
