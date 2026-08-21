import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiBase = process.env.JARVIS_API_BASE;
const oidcToken = process.env.JARVIS_OIDC_TOKEN;
if (!apiBase || !oidcToken) throw new Error("JARVIS_API_BASE and JARVIS_OIDC_TOKEN are required");

const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function lines(text, max = 34, count = 8) {
  const words = String(text).replace(/\[[^\]]+\]/g, "").replace(/\s+/g, " ").trim().split(" ");
  const output = []; let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) { output.push(line); line = word; } else line = next;
    if (output.length >= count) break;
  }
  if (line && output.length < count) output.push(line);
  return output;
}

function textBlock(text, x, y, max, size, count, lineHeight, weight = 600, color = "#17211d") {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}">${lines(text, max, count).map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function artwork(spec, width, height, focus, detail, index = 0) {
  const portrait = height > width; const pad = Math.round(width * .075); const headlineY = portrait ? Math.round(height * .27) : Math.round(height * .3);
  const headlineSize = portrait ? 72 : 64; const bodySize = portrait ? 39 : 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7faF3"/><stop offset="1" stop-color="#dfead9"/></linearGradient><linearGradient id="orb"><stop stop-color="#b9ef62"/><stop offset="1" stop-color="#3c8249"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#bg)"/><circle cx="${width * .88}" cy="${height * .1}" r="${width * .25}" fill="#b9ef62" opacity=".28"/><circle cx="${width * .05}" cy="${height * .9}" r="${width * .32}" fill="#245f35" opacity=".08"/>
    <g transform="translate(${pad} ${pad})"><rect width="66" height="66" rx="18" fill="#245f35"/><text x="33" y="46" text-anchor="middle" fill="white" font-family="DejaVu Sans" font-size="37" font-weight="800">J</text><text x="85" y="30" fill="#245f35" font-family="DejaVu Sans" font-size="24" font-weight="800">ClothMatics</text><text x="85" y="57" fill="#64756b" font-family="DejaVu Sans" font-size="17">powered by Jarvis</text></g>
    <g opacity=".95" transform="translate(${width * .65} ${height * .55})"><path d="M0 0 C55 -80 150 -80 205 0 L250 330 H-45Z" fill="#2f7040"/><path d="M65 -38 C82 -85 123 -85 140 -38" fill="none" stroke="#2f7040" stroke-width="18" stroke-linecap="round"/><path d="M70 55h75v115H70z" fill="#b9ef62" opacity=".8"/><circle cx="107" cy="112" r="18" fill="#f7faf3"/></g>
    ${textBlock(focus, pad, headlineY, portrait ? 23 : 30, headlineSize, portrait ? 6 : 4, Math.round(headlineSize * 1.17), 800)}
    ${textBlock(detail, pad, portrait ? Math.round(height * .64) : Math.round(height * .73), portrait ? 39 : 54, bodySize, portrait ? 6 : 3, Math.round(bodySize * 1.45), 500, "#405148")}
    <rect x="${pad}" y="${height - pad - 68}" width="${Math.min(width - pad * 2, 480)}" height="68" rx="34" fill="#245f35"/><text x="${pad + Math.min(width - pad * 2, 480) / 2}" y="${height - pad - 24}" text-anchor="middle" fill="white" font-family="DejaVu Sans" font-size="24" font-weight="700">Make your wardrobe work smarter</text>
    <text x="${width - pad}" y="${height - pad}" text-anchor="end" fill="#6d7d73" font-family="DejaVu Sans" font-size="18">${escapeXml(spec.channel.replaceAll("_", " "))} · ${index + 1}</text>
  </svg>`;
}

function renderImage(task, spec, dir) {
  const svg = join(dir, `${task.id}.svg`); const output = join(dir, `${task.id}.png`);
  writeFileSync(svg, artwork(spec, task.width, task.height, spec.hook, spec.cta));
  execFileSync("rsvg-convert", ["-w", String(task.width), "-h", String(task.height), "-o", output, svg], { stdio: "inherit" });
  return output;
}

function renderVideo(task, spec, dir) {
  const bodyParts = String(spec.body).split(/\n\s*\n|(?<=\.)\s+/).filter(Boolean);
  const scenes = [
    [spec.hook, "A real wardrobe problem, explained simply."],
    [bodyParts[0] ?? spec.title, bodyParts[1] ?? "See what you already own before buying more."],
    [bodyParts[2] ?? spec.title, bodyParts[3] ?? "Make one useful decision from your own clothes."],
    [spec.cta, "ClothMatics · your wardrobe, made understandable."],
  ];
  const concat = [];
  scenes.forEach(([focus, detail], index) => {
    const svg = join(dir, `scene-${index}.svg`); const png = join(dir, `scene-${index}.png`);
    writeFileSync(svg, artwork(spec, task.width, task.height, focus, detail, index));
    execFileSync("rsvg-convert", ["-w", String(task.width), "-h", String(task.height), "-o", png, svg]);
    concat.push(`file '${png.replaceAll("'", "'\\''")}'`, "duration 7.5");
  });
  concat.push(`file '${join(dir, "scene-3.png").replaceAll("'", "'\\''")}'`);
  const list = join(dir, "scenes.txt"); writeFileSync(list, concat.join("\n"));
  const narration = [spec.hook, ...bodyParts.slice(0, 4), spec.cta].join(" ").replace(/\[[^\]]+\]/g, "").slice(0, 1200);
  const wav = join(dir, "voice.wav"); execFileSync("espeak-ng", ["-v", "en-in", "-s", "150", "-w", wav, narration]);
  const output = join(dir, `${task.id}.mp4`);
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-i", wav, "-t", String(task.duration_seconds ?? 30), "-vf", `scale=${task.width}:${task.height}:force_original_aspect_ratio=decrease,pad=${task.width}:${task.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`, "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", output], { stdio: "inherit" });
  return output;
}

async function request(path, init = {}) {
  return fetch(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${oidcToken}`, ...(init.headers ?? {}) } });
}

for (let processed = 0; processed < 5; processed += 1) {
  const claim = await request("/api/media/renderer/claim", { method: "POST" });
  if (!claim.ok) throw new Error(`Claim failed ${claim.status}: ${await claim.text()}`);
  const { task } = await claim.json();
  if (!task) { console.log("No queued media renders."); break; }
  const dir = mkdtempSync(join(tmpdir(), "jarvis-media-"));
  try {
    const spec = JSON.parse(task.spec_json);
    const output = task.media_kind === "video" ? renderVideo(task, spec, dir) : renderImage(task, spec, dir);
    const upload = await request(`/api/media/renderer/${task.id}/upload`, { method: "POST", headers: { "Content-Type": task.media_kind === "video" ? "video/mp4" : "image/png" }, body: readFileSync(output) });
    if (!upload.ok) throw new Error(`Upload failed ${upload.status}: ${await upload.text()}`);
    console.log(`Rendered ${task.media_kind} ${task.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await request(`/api/media/renderer/${task.id}/fail`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: message }) });
    console.error(`Render failed ${task.id}: ${message}`);
  }
}
