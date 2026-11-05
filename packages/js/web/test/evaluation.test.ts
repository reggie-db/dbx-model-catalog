import { expect, test } from "bun:test";
import {
  evaluationVariantLabels,
  reasoningBudgetLabel,
  reasoningControlLabels,
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

test("labels model-supported reasoning controls", () => {
  expect(reasoningControlLabels({
    supported: true,
    effort: ["low", "medium", "high", "xhigh", "max"],
    toggle: true,
    budget: { min: 1024, max: 32768 },
  })).toEqual([
    "Low reasoning",
    "Medium reasoning",
    "High reasoning",
    "Extra-high reasoning",
    "Maximum reasoning",
    "Toggle",
    "Token budget",
  ]);
  expect(reasoningBudgetLabel({ min: 1024, max: 32768 })).toBe("1,024–32,768 tokens");
});
