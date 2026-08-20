import type { AIProvider, GenerateRequest, GenerationResult } from "@jarvis/ai";

interface NvidiaChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: Record<string, unknown>;
  error?: { message?: string };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidate = fenced ?? trimmed;
  const objectStart = candidate.indexOf("{");
  const objectEnd = candidate.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error("NVIDIA response did not contain a JSON object");
  }
  return JSON.parse(candidate.slice(objectStart, objectEnd + 1));
}

export class NvidiaProvider implements AIProvider {
  readonly name = "nvidia";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generateText(system: string, prompt: string): Promise<string> {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(55_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1024,
        stream: false,
      }),
    });

    const body = (await response.json()) as NvidiaChatResponse;
    if (!response.ok) {
      throw new Error(`NVIDIA API ${response.status}: ${body.error?.message ?? "request failed"}`);
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("NVIDIA API returned no message content");
    return content;
  }

  async generateStructured<T>(request: GenerateRequest<T>): Promise<GenerationResult<T>> {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(55_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        temperature: request.temperature ?? 0.2,
        max_tokens: 1800,
        stream: false,
      }),
    });

    const body = (await response.json()) as NvidiaChatResponse;
    if (!response.ok) {
      throw new Error(`NVIDIA API ${response.status}: ${body.error?.message ?? "request failed"}`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("NVIDIA API returned no message content");
    const data = request.schema.parse(extractJson(content));
    return { data, model: body.model ?? this.model, usage: body.usage ?? null };
  }
}
