import { parse, type ParsingReference } from "chrono-node";
import { z } from "zod";

const UTC_REFERENCE = { timezone: 0 } satisfies ParsingReference;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;

export function parseFlexibleDate(value: string): Date | null {
  const normalized = YEAR_MONTH_PATTERN.test(value) ? `${value}-01` : value;
  const result = parse(normalized, UTC_REFERENCE)[0];
  if (!result) return null;

  const date = result.start.date();
  if (!result.start.isCertain("hour")) {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date;
}

export const flexibleDateSchema = z.union([
  z.date(),
  z.string().transform((value, context) => {
    const date = parseFlexibleDate(value);
    if (date) return date;

    context.addIssue({
      code: "custom",
      message: `Could not parse date: ${value}`,
    });
    return z.NEVER;
  }),
]);
