import { expect, test } from "bun:test";
import {
  evaluationLabelsForResults,
  evaluationVariantLabels,
} from "../src/evaluation.js";

test("labels thinking and reasoning effort independently", () => {
  expect(evaluationVariantLabels({
    reasoning: true,
    reasoning_effort: "max",
    reasoning_mode: "thinking",
  })).toEqual(["Thinking", "Maximum reasoning"]);
});

test("labels reasoning when no mode or effort is available", () => {
  expect(evaluationVariantLabels({ reasoning: true })).toEqual(["Reasoning"]);
});

test("deduplicates evaluation labels across results", () => {
  expect(evaluationLabelsForResults([
    { variant: { reasoning_effort: "high" } },
    { variant: { reasoning: true, reasoning_mode: "thinking" } },
    { variant: { reasoning_effort: "high" } },
  ])).toEqual(["Thinking", "High reasoning"]);
});
