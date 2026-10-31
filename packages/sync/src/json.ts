export function stringifyJson(
  value: unknown,
  space?: string | number,
): string | undefined {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    space,
  );
}
