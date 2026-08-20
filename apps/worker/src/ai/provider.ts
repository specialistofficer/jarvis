import type { AIProvider } from "@jarvis/ai";
import { mayExecuteProviderCall } from "@jarvis/shared";
import type { Env } from "../env";
import { DeferredJobError } from "../errors";
import { DevelopmentMockProvider } from "./mock";
import { NvidiaProvider } from "./nvidia";

export function selectAIProvider(env: Env): AIProvider {
  if (env.ENVIRONMENT !== "production" && env.DEV_MOCK_AI === "true") {
    return new DevelopmentMockProvider();
  }
  if (!env.NVIDIA_API_KEY) throw new DeferredJobError("NVIDIA_API_KEY is not configured");

  const allowance = {
    provider: "NVIDIA API",
    freeAllowance: env.NVIDIA_FREE_ALLOWANCE_REMAINING === "true" ? "confirmed" : "not confirmed",
    currentUsage: "tracked externally in V1",
    estimatedCostInr: 0,
    allowed: env.NVIDIA_FREE_ALLOWANCE_REMAINING === "true",
  };
  if (!mayExecuteProviderCall(allowance)) {
    throw new DeferredJobError("NVIDIA free allowance is not explicitly confirmed; zero-spend guard deferred the call");
  }
  return new NvidiaProvider(env.NVIDIA_API_KEY, env.NVIDIA_MODEL);
}
