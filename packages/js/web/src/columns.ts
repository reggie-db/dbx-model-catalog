import type { VisibilityState } from "@tanstack/react-table";
import { z } from "zod";

export const columnLabels = {
  aliases: "Aliases",
  benchmarks: "Top benchmark",
  capabilities: "Capabilities",
  categoryRank: "Best category rank",
  clouds: "Clouds",
  context: "Context",
  family: "Family",
  inputLimit: "Input limit",
  inputModalities: "Input modalities",
  knowledgeCutoff: "Knowledge cutoff",
  license: "License",
  model: "Model",
  openWeights: "Open weights",
  outputLimit: "Output limit",
  outputModalities: "Output modalities",
  overallRank: "Best overall rank",
  publisher: "Publisher",
  reasoningControls: "Reasoning controls",
  relevance: "Relevance",
  released: "Released",
  servingModes: "Serving modes",
  status: "Status",
  tasks: "Tasks",
  type: "Type",
  updated: "Updated",
  useCases: "Use cases",
} as const;

export type CatalogColumnId = keyof typeof columnLabels;

function isCatalogColumnId(value: string): value is CatalogColumnId {
  return Object.hasOwn(columnLabels, value);
}

export function columnLabel(id: string): string {
  return isCatalogColumnId(id) ? columnLabels[id] : id;
}

export const catalogColumnIdSchema = z.string().refine(isCatalogColumnId, {
  message: "Unknown catalog column",
});

export const defaultColumnVisibility: VisibilityState = {
  aliases: false,
  categoryRank: false,
  inputModalities: false,
  inputLimit: false,
  knowledgeCutoff: false,
  license: false,
  openWeights: false,
  outputModalities: false,
  outputLimit: false,
  relevance: false,
  released: false,
  servingModes: false,
  tasks: false,
  type: false,
  updated: false,
  useCases: false,
};
