export const COST_POLICY = Object.freeze({
  allowPaidSpend: false,
  maxCostInr: 0,
});

export interface ProviderAllowance {
  provider: string;
  freeAllowance: string;
  currentUsage: string;
  estimatedCostInr: number;
  allowed: boolean;
}

export function mayExecuteProviderCall(allowance: ProviderAllowance): boolean {
  return allowance.allowed && allowance.estimatedCostInr <= COST_POLICY.maxCostInr;
}

export function normalizeFingerprint(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .sort()
    .filter((token, index, tokens) => token !== tokens[index - 1])
    .join(" ");
}

export function jaccardSimilarity(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
