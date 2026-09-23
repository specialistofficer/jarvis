# ARCHITECTURE.md — Personal AI Client Acquisition Agent

This document defines the architecture, design principles, module structure, data models, integration boundaries, security posture, and deployment strategies for the **Personal AI Client Acquisition Agent** integrated with the **Jarvis** system.

---

## 1. System Vision & Objective

The **Personal AI Client Acquisition Agent** acts as an autonomous business-development assistant for a senior freelance software developer (10+ years experience across Java/Spring Boot enterprise backends, React web frontends, and production Android apps).

### Primary Directive
> **Maximize qualified client conversations and paid project wins at minimal cost and zero hallucination—NEVER maximize raw application spam.**

The system operates under strict constraints:
- **Zero Factual Invention:** Never invent experience, clients, certifications, revenue, employers, technologies, case studies, or project results.
- **Strict Compliance:** Adhere to platform terms of service. Where automated submissions are prohibited, automate discovery, scoring, and proposal drafting, then route to the owner with a direct link for manual submission.
- **Strict Cost Control:** Model application costs (connects, platform tokens, proposal limits) and AI token consumption before taking action.
- **Approval-First Workflow:** Default to `APPROVAL_REQUIRED` mode. Human-in-the-loop via interactive Telegram bot and React dashboard.

---

## 2. High-Level Architecture

```text
                                  OWNER / DEVELOPER
                                     ▲          ▲
                     Telegram Bot    │          │  React Dashboard
                     (Mobile UX)     │          │  (Web Desktop/PWA)
                                     ▼          ▼
                      ┌────────────────────────────────────┐
                      │    FASTAPI CLIENT AGENT SERVICE    │
                      │         (apps/client_agent)        │
                      └─────────────────┬──────────────────┘
                                        │
                         Agent Orchestrator Pipeline
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
   Discovery Agent             Opportunity Agent              Strategy Agent
  (Multi-Source Adapter)     (Scoring & Match Engine)      (Economics & Experiments)
           │                            │                            │
           └────────────────────────────┼────────────────────────────┘
                                        │
                                  Action Planner
                                        │
                        ┌───────────────┴───────────────┐
                        ▼                               ▼
                 Proposal Agent                   Outreach Agent
             (Factual Verification)           (Direct Client Pitches)
                        │                               │
                        └───────────────┬───────────────┘
                                        │
                                 Response Monitor
                                        │
                                  Response Agent
                                        │
                                 Learning Engine
                                        │
                                        ▼
                      ┌────────────────────────────────────┐
                      │     SQLITE / POSTGRESQL / D1       │
                      │  (Persistent Storage & Audit Log)  │
                      └────────────────────────────────────┘
```

---

## 3. Component & Module Breakdown

### 3.1 Owner Profile & Portfolio Intelligence (`src/profile/`)
- **Owner Profile:** Configurable profile model containing verified technical proficiencies, enterprise background (Java, Spring Boot, Oracle, Microservices), mobile background (Production Android on Google Play, React Native), web background (React, TypeScript), and AI integration skills.
- **Portfolio Knowledge Base:** Searchable catalog of factual case studies, completed websites, repositories, and Google Play apps with tagged technologies, problem-solved statements, and verifiable URLs.
- **Portfolio Selector:** Semantic and tag-based matching algorithm that picks the 1-2 most relevant portfolio items for each opportunity (e.g., selecting the Google Play app for Android tasks, enterprise financial services for Java/Spring tasks).

### 3.2 Multi-Source Discovery Engine (`src/sources/`)
Each source implements a standard adapter interface with a strict **Source Capability Definition**:

```python
class SourceCapability(BaseModel):
    source: str
    search_supported: bool
    read_supported: bool
    application_supported: bool
    direct_contact_supported: bool
    api_available: bool
    browser_automation_allowed: bool
    application_cost: float
    daily_limit: int
    monthly_limit: int
    requires_human_approval: bool
```

**Categories Supported:**
1. **Freelance Marketplaces:** Upwork, Freelancer, Contra, Guru, PeoplePerHour.
2. **Direct Remote Boards & Startups:** RemoteOK, WeWorkRemotely, Y Combinator Work at a Startup, company career/project pages.
3. **Professional & Community Sources:** LinkedIn, Reddit (r/forhire, r/freelance_forhire), Discord/X communities where permitted.

**Deduplication & Fingerprinting:**
- Generates a deterministic SHA256 fingerprint from `(source, external_id || normalized_title + client_id + budget)`.
- Prevents redundant processing and ignores expired or stale postings.

### 3.3 Opportunity Intelligence & Economics (`src/intelligence/`)
- **Structured Scoring:**
  - `technical_match` (0-100%): Match between required tech and owner skills.
  - `portfolio_match` (0-100%): Availability of directly relevant factual portfolio items.
  - `client_quality` (0-100%): Client spend history, rating, payment verification, hire rate.
  - `value_score` (0-100%): Budget vs estimated difficulty and market rate.
  - `competition_score` (0-100%): Number of proposals, client review speed.
  - `risk_score` (0-100%): Vague requirements, unrealistic timelines, red flags.
- **Application Economics Engine:**
  - Evaluates expected monetary value vs application cost (connects, tokens, platform fees).
  - Decision Policy: Apply only when Expected Value $\ge$ Threshold and Risk $\le$ Threshold.

### 3.4 Proposal & Factual Verification Engine (`src/proposals/`)
- **Proposal Generation:** Problem-first, concise, conversational proposals demonstrating concrete implementation approaches rather than generic boilerplate.
- **Factual Guard (Critical):** Evaluates draft against the Owner Profile & Portfolio. Blocks submission if any unverified client name, false metric, invented technology, or fake claim is detected.

### 3.5 Interaction & Control (`src/interfaces/`)
- **Telegram Bot:** Primary mobile control channel with inline interactive keyboards (`[APPLY]`, `[SKIP]`, `[EDIT]`, `[VIEW]`, `[SEND]`).
- **React Dashboard:** Web interface for deep visibility into Opportunities, Applications, Analytics, Strategy, and Portfolio management.

### 3.6 Response & Follow-up Engine (`src/responses/`)
- Continuous inbox monitoring across supported sources.
- Intent classification: `INTERESTED`, `QUESTION`, `INTERVIEW`, `NEGOTIATION`, `REJECTION`, `SPAM`, `UNCLEAR`.
- Context retrieval: Generates drafted replies for founder review before sending.

### 3.7 Learning & Strategy Engine (`src/learning/`)
- Tracks lifecycle conversions: `DISCOVERED` -> `QUALIFIED` -> `PROPOSAL_READY` -> `APPLIED` -> `CLIENT_VIEWED` -> `CLIENT_REPLIED` -> `INTERVIEW` -> `WON` / `LOST`.
- Analyzes which technologies, budget ranges, platforms, and proposal styles produce actual client conversations.
- Supports controlled A/B experiments (e.g., Short vs Medium proposal, Solution-first vs Portfolio-first).

---

## 4. Integration with Existing Jarvis Architecture

### Coexistence Model
1. **Jarvis Cloudflare Worker & D1 (Edge Layer):**
   - Continues running the 24/7 low-latency API, authentication gate, static dashboard hosting (Pages), and hourly cron.
   - Cloudflare D1 stores venture milestones, high-level metrics, and synchronized opportunity feeds.
2. **Personal AI Client Agent Service (Python/FastAPI Layer):**
   - Houses Playwright browser automation, deep Gemini AI orchestration, Telegram webhook/polling daemon, and heavy scraping tasks that cannot run in edge V8 isolates.
   - Communicates with the Worker API / D1 via authenticated REST endpoints and webhooks.
3. **Unified Dashboard (`apps/dashboard`):**
   - Existing React dashboard is expanded with dedicated views for Client Acquisition: Opportunities, Applications, Analytics, and Portfolio.

---

## 5. Security & Safety Posture

1. **Zero Secret Leaks:** All API keys (Gemini, Telegram Bot Token, platform credentials) reside in local `.env` or secure secrets management. No secrets in Git, logs, or prompts.
2. **Platform Terms Compliance:** Automated submissions are strictly disabled on platforms prohibiting headless browser submission. Manual submission URLs are provided.
3. **Anti-Hallucination Gate:** Proposals must pass through an automated verification pass that checks claims strictly against the stored profile.
4. **Rate Limiting & Cost Caps:** Strict daily and monthly token and request limits.

---

## 6. Deployment Strategy

- **Development:** Local Python virtual environment (`python >= 3.11`), SQLite database, local Playwright headless browser, and Vite dev server.
- **Production:** Docker container running FastAPI + Playwright on a low-cost VPS or serverless container platform, paired with Cloudflare Pages for the frontend and Telegram Webhook for real-time mobile interaction.
