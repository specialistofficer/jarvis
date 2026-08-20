import type { z } from "zod";

export interface GenerateRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
}

export interface GenerationResult<T> {
  data: T;
  model: string;
  usage: Record<string, unknown> | null;
}

export interface AIProvider {
  readonly name: string;
  generateText(system: string, prompt: string): Promise<string>;
  generateStructured<T>(request: GenerateRequest<T>): Promise<GenerationResult<T>>;
}
