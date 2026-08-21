import type { Env } from "../env";

interface GrowthAssetRow {
  id: string; goal_id: string; asset_type: string; channel: string; title: string; hook: string;
  body: string; cta: string; production_notes: string; status: string;
}

interface NvidiaImageResponse {
  artifacts?: Array<{ base64?: string; seed?: number }>;
  error?: { message?: string };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function visualPrompt(asset: GrowthAssetRow): string {
  return `Premium, high-tech, futuristic software agency image. Dark mode, sleek dashboard, neon accents, modern workspace. ${asset.hook} High quality, 8k resolution, photorealistic, cinematic lighting, no text, no watermark, clean composition.`;
}

async function tryNvidiaImage(env: Env, prompt: string): Promise<{ bytes: Uint8Array; model: string } | null> {
  if (!env.NVIDIA_API_KEY || env.NVIDIA_FREE_ALLOWANCE_REMAINING !== "true") return null;
  const model = env.NVIDIA_IMAGE_MODEL || "stabilityai/stable-diffusion-xl";
  const endpoint = model === "stabilityai/stable-diffusion-xl"
    ? "https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl"
    : `https://ai.api.nvidia.com/v1/genai/${model}`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(55_000),
    headers: { Authorization: `Bearer ${env.NVIDIA_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(model === "stabilityai/stable-diffusion-xl" ? {
      text_prompts: [
        { text: prompt, weight: 1 },
        { text: "text, watermark, distorted clothing, extra limbs, low quality", weight: -1 },
      ],
      height: 1024, width: 1024, cfg_scale: 5, steps: 25, samples: 1, seed: 0,
    } : { prompt, height: 1024, width: 1024, steps: 4, samples: 1, seed: 0 }),
  });
  const body = await response.json().catch(() => ({})) as NvidiaImageResponse;
  const encoded = body.artifacts?.[0]?.base64;
  if (!response.ok || !encoded) throw new Error(`NVIDIA visual endpoint ${response.status}: ${body.error?.message ?? "no image returned"}`);
  return { bytes: decodeBase64(encoded), model };
}

export async function runMediaProduction(env: Env, payload: Record<string, unknown>): Promise<{ mediaId: string; kind: string; status: string; provider: string }> {
  const growthAssetId = typeof payload.growthAssetId === "string" ? payload.growthAssetId : "";
  if (!growthAssetId) throw new Error("media_production requires growthAssetId");
  const asset = await env.DB.prepare("SELECT * FROM growth_assets WHERE id = ? AND status != 'deleted'")
    .bind(growthAssetId).first<GrowthAssetRow>();
  if (!asset) throw new Error("Growth asset not found");
  const existing = await env.DB.prepare("SELECT id, media_kind, status, provider FROM media_assets WHERE growth_asset_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 1")
    .bind(asset.id).first<{ id: string; media_kind: string; status: string; provider: string }>();
  if (existing) return { mediaId: existing.id, kind: existing.media_kind, status: existing.status, provider: existing.provider };

  const isVideo = asset.asset_type.includes("video") || asset.channel.includes("youtube");
  const mediaId = crypto.randomUUID();
  const publicId = crypto.randomUUID();
  const kind = isVideo ? "video" : "image";
  const width = isVideo ? 1080 : asset.channel === "linkedin" || asset.channel === "seo" ? 1200 : 1080;
  const height = isVideo ? 1920 : asset.channel === "linkedin" || asset.channel === "seo" ? 628 : 1080;
  const prompt = visualPrompt(asset);
  const spec = {
    title: asset.title, hook: asset.hook, body: asset.body, cta: asset.cta, channel: asset.channel,
    productionNotes: asset.production_notes, brand: "Jarvis Tech Agency", palette: { background: "#0a0a0a", primary: "#00ffcc", accent: "#ffffff", text: "#e0e0e0" },
  };
  await env.DB.prepare(`INSERT INTO media_assets
    (id, growth_asset_id, goal_id, media_kind, format, width, height, duration_seconds, provider, prompt, spec_json, status, public_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'jarvis_renderer', ?, ?, 'render_queued', ?)`)
    .bind(mediaId, asset.id, asset.goal_id, kind, isVideo ? "video/mp4" : "image/png", width, height, isVideo ? 30 : null, prompt, JSON.stringify(spec), publicId).run();

  if (!isVideo) {
    try {
      const generated = await tryNvidiaImage(env, prompt);
      if (generated) {
        const usage = await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) total FROM media_assets WHERE status != 'deleted'").first<{ total: number }>();
        if (Number(usage?.total ?? 0) + generated.bytes.byteLength > 8 * 1024 * 1024 * 1024) throw new Error("Jarvis 8 GB zero-spend storage guard reached");
        const key = `generated/${mediaId}.png`;
        await env.MEDIA.put(key, generated.bytes, { httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" } });
        await env.DB.prepare(`UPDATE media_assets SET status = 'ready_for_review', provider = 'nvidia', model = ?, storage_key = ?, bytes = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .bind(generated.model, key, generated.bytes.byteLength, mediaId).run();
        return { mediaId, kind, status: "ready_for_review", provider: "nvidia" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare("UPDATE media_assets SET last_error = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(`NVIDIA unavailable; branded renderer queued. ${message}`.slice(0, 1200), mediaId).run();
    }
  }
  return { mediaId, kind, status: "render_queued", provider: "jarvis_renderer" };
}
