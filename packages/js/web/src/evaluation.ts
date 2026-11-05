import type { CatalogModel } from "@dbx-tools/dbx-model-catalog/browser";

type RankingVariant = NonNullable<CatalogModel["rankings"][number]["variant"]>;
type BenchmarkVariant = NonNullable<CatalogModel["benchmarks"][number]["variant"]>;

export type EvaluationVariant = RankingVariant | BenchmarkVariant;
export type ReasoningCapability = CatalogModel["capabilities"]["reasoning"];

export function reasoningControlLabels(reasoning: ReasoningCapability) {
  if (!reasoning?.supported) return [];
  const labels: string[] = [...(reasoning.effort ?? [])];
  if (reasoning.toggle) labels.push("Toggle");
  if (reasoning.budget && (reasoning.budget.min != null || reasoning.budget.max != null)) {
    labels.push("Token budget");
  }
  return labels.length ? labels : ["Supported"];
}

export function reasoningBudgetLabel(
  budget: { max?: number | null; min?: number | null } | null | undefined,
) {
  if (!budget || (budget.min == null && budget.max == null)) return null;
  const format = (value: number) => new Intl.NumberFormat().format(value);
  if (budget.min != null && budget.max != null) {
    return budget.min === budget.max
      ? `${format(budget.min)} tokens`
      : `${format(budget.min)}–${format(budget.max)} tokens`;
  }
  return budget.min != null
    ? `At least ${format(budget.min)} tokens`
    : `Up to ${format(budget.max!)} tokens`;
}

export function evaluationVariantLabels(variant: EvaluationVariant | null | undefined) {
  if (!variant) return [];

  const labels: string[] = [];
  if (variant.reasoning_mode) labels.push(variant.reasoning_mode);

  const effort = variant.reasoning_effort;
  if (effort) labels.push(effort);
  if (variant.reasoning === true && !variant.reasoning_mode && !effort) labels.push("reasoning");

  return labels;
}
