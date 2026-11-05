import type { CatalogModel } from "@dbx-tools/dbx-model-catalog/browser";

type RankingVariant = NonNullable<CatalogModel["rankings"][number]["variant"]>;
type BenchmarkVariant = NonNullable<CatalogModel["benchmarks"][number]["variant"]>;

export type EvaluationVariant = RankingVariant | BenchmarkVariant;

interface EvaluationResult {
  variant?: EvaluationVariant | null;
}

const reasoningEffortLabels: Record<string, string> = {
  default: "Default reasoning",
  high: "High reasoning",
  low: "Low reasoning",
  max: "Maximum reasoning",
  medium: "Medium reasoning",
  minimal: "Minimal reasoning",
  none: "No reasoning",
  xhigh: "Extra-high reasoning",
};

const evaluationLabelPriority = [
  "Thinking",
  "Automatic reasoning",
  "Reasoning",
  "Maximum reasoning",
  "Extra-high reasoning",
  "High reasoning",
  "Medium reasoning",
  "Low reasoning",
  "Minimal reasoning",
  "Default reasoning",
  "No reasoning",
];

export function evaluationVariantLabels(variant: EvaluationVariant | null | undefined) {
  if (!variant) return [];

  const labels: string[] = [];
  if (variant.reasoning_mode === "thinking") labels.push("Thinking");
  if (variant.reasoning_mode === "auto") labels.push("Automatic reasoning");

  const effort = variant.reasoning_effort;
  if (effort) labels.push(reasoningEffortLabels[effort] ?? `${effort} reasoning`);
  if (variant.reasoning === true && !variant.reasoning_mode && !effort) labels.push("Reasoning");

  return labels;
}

export function evaluationLabelsForResults(results: readonly EvaluationResult[]) {
  return [...new Set(results.flatMap(result => evaluationVariantLabels(result.variant)))]
    .sort((left, right) => {
      const leftPriority = evaluationLabelPriority.indexOf(left);
      const rightPriority = evaluationLabelPriority.indexOf(right);
      return (leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority)
        - (rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority)
        || left.localeCompare(right);
    });
}
