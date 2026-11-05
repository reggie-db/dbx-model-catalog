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
  })).toEqual(["thinking", "max"]);
});

test("labels reasoning when no mode or effort is available", () => {
  expect(evaluationVariantLabels({ reasoning: true })).toEqual(["reasoning"]);
});

test("labels model-supported reasoning controls", () => {
  expect(reasoningControlLabels({
    supported: true,
    effort: ["low", "medium", "high", "xhigh", "max"],
    toggle: true,
    budget: { min: 1024, max: 32768 },
  })).toEqual([
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "Toggle",
    "Token budget",
  ]);
  expect(reasoningBudgetLabel({ min: 1024, max: 32768 })).toBe("1,024–32,768 tokens");
});
