import type { CatalogModelRecord } from "./_generated/schemas.js";

export type ModelIdentityKind = "endpoint" | "model-service" | "provider" | "alias";

export interface ModelIdentity {
  readonly kind: ModelIdentityKind;
  readonly provider?: string;
  readonly value: string;
}

const providerPrefixes = new Set([
  "alibaba",
  "anthropic",
  "deepseek",
  "google",
  "meta",
  "moonshot",
  "openai",
  "xai",
  "zhipu",
]);

const providerFamilies = [
  "claude",
  "deepseek",
  "gemini",
  "gemma",
  "glm",
  "gpt",
  "grok",
  "gte",
  "bge",
  "kimi",
  "llama",
  "qwen",
] as const;

/** Normalize endpoint, system-service, and provider identities for exact joins. */
export function normalizeModelIdentity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^system\.ai[.-]/, "")
    .replace(/^databricks-/, "")
    .replace(/([a-z])(\d)/g, "$1-$2")
    .replace(/(\d)([a-z])/g, "$1-$2")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Return the broad provider family used for serving and routing policy. */
export function modelProviderFamily(value: string): string | undefined {
  const tokens = normalizeModelIdentity(value).split("-");
  return providerFamilies.find(family => tokens.includes(family));
}

/** Return up to three numeric version components from a model identity. */
export function modelVersion(value: string): readonly number[] {
  const match = /(?:^|[^a-z0-9])(\d+)(?:[.\-_](\d+))?(?:[.\-_](\d+))?(?![a-z0-9])/i.exec(value);
  return match ? match.slice(1).filter(Boolean).map(Number) : [];
}

/** Classify every published identity without losing the existing aliases array. */
export function modelIdentities(record: CatalogModelRecord): readonly ModelIdentity[] {
  const identities = [record.id, ...record.aliases];
  return identities.map((value, index) => {
    if (index === 0 || value.startsWith("databricks-")) return { kind: "endpoint", value };
    if (value.startsWith("system.ai.")) return { kind: "model-service", value };
    const separator = value.indexOf("/");
    if (separator > 0 && providerPrefixes.has(value.slice(0, separator).toLowerCase())) {
      return {
        kind: "provider",
        provider: value.slice(0, separator).toLowerCase(),
        value,
      };
    }
    return { kind: "alias", value };
  });
}
