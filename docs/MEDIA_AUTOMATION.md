# Jarvis media automation

Jarvis now separates content planning from actual media production.

## Production flow

1. Founder approves a content plan.
2. `media_production` attempts the configured NVIDIA visual endpoint while the confirmed free allowance and zero-spend guard permit it.
3. If the hosted visual endpoint is unavailable, the asset is sent to the Jarvis renderer instead of being falsely marked complete.
4. The public `specialistofficer/jarvis` repository runs the renderer on standard GitHub-hosted Actions. It creates real PNG artwork or a vertical H.264 MP4 with FFmpeg and voiceover.
5. GitHub authenticates to the Worker with a short-lived OIDC token restricted to `specialistofficer/jarvis` on `main`.
6. Rendered files are stored in the isolated `jarvis-media` R2 bucket and displayed in Media Studio for approval.

The existing `clothmatics-images` bucket is not read, written, or bound to Jarvis.

## Zero-spend controls

- `ALLOW_PAID_SPEND=false` remains the governing policy.
- NVIDIA calls require an explicitly confirmed free allowance.
- Jarvis enforces an 8 GB application storage ceiling, below R2's current 10 GB monthly free allocation.
- Renderer jobs use standard runners in a public repository.
- Each render has a bounded three-attempt limit.

Cloudflare and GitHub quotas remain external account-level limits. Jarvis does not enable billing or purchase overages.

## Google Drive and downloaded models

Google Drive is represented as a disconnected `model_warehouse` / `asset_archive` connection. Drive can store model files and completed assets, but it cannot execute a GPU model. A future Drive sync requires a Google OAuth client and one-time founder authorization. Large local models additionally require a separate compatible GPU runner; storing them in Drive does not make them executable from Cloudflare Workers.

## Publishing and analytics

Instagram, LinkedIn, X, YouTube, and product analytics connectors are explicitly tracked as `not_connected`. Media generation works independently. Automatic external publishing and analytics collection remain blocked until official OAuth applications and founder account authorization exist.
