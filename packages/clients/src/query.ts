import {
  CatalogModelIdSchema,
  CatalogModelSchema,
  type CatalogModel,
} from "@dbx-model-catalog/common";
import { filter } from "@mcabreradev/filter/core";
import type {
  Expression,
  FilterOptions,
  NestedKeyOf,
  SortDirection,
} from "@mcabreradev/filter";
import { z } from "zod";

export const CatalogModelRecordSchema = CatalogModelSchema.extend({
  id: CatalogModelIdSchema,
}).strict();

export type CatalogModelRecord = z.infer<typeof CatalogModelRecordSchema>;

type JsonPrimitive = string | number | boolean | null;

type SerializablePrimitiveOperators<T extends JsonPrimitive> = {
  readonly $eq?: T;
  readonly $ne?: T;
  readonly $in?: ReadonlyArray<T>;
  readonly $nin?: ReadonlyArray<T>;
} & (T extends number
  ? {
      readonly $gt?: number;
      readonly $gte?: number;
      readonly $lt?: number;
      readonly $lte?: number;
    }
  : object) &
  (T extends string
    ? {
        readonly $startsWith?: string;
        readonly $endsWith?: string;
        readonly $contains?: string;
        readonly $regex?: string;
        readonly $match?: string;
      }
    : object);

type SerializableArrayOperators<T> = {
  readonly $size?: number;
} & (T extends JsonPrimitive ? { readonly $contains?: T } : object);

type SerializableFieldExpression<T> = T extends JsonPrimitive
  ? T | ReadonlyArray<T> | SerializablePrimitiveOperators<T>
  : T extends ReadonlyArray<infer Item>
    ? | SerializableFieldExpression<Item>
      | ReadonlyArray<SerializableFieldExpression<Item>>
      | SerializableArrayOperators<Item>
    : T extends object
      ? SerializableObjectExpression<T>
      : never;

type SerializableObjectExpression<T> = {
  readonly [Key in keyof T]?: SerializableFieldExpression<NonNullable<T[Key]>>;
} & {
  readonly $and?: ReadonlyArray<SerializableCatalogExpression<T>>;
  readonly $or?: ReadonlyArray<SerializableCatalogExpression<T>>;
  readonly $not?: SerializableCatalogExpression<T>;
};

type SerializableCatalogExpression<T> =
  | JsonPrimitive
  | SerializableObjectExpression<T>;

export type SerializableCatalogQueryExpression =
  SerializableCatalogExpression<CatalogModelRecord>;
export type CatalogQuery =
  | SerializableCatalogQueryExpression
  | ((model: CatalogModelRecord) => boolean);
export type CatalogSortField = NestedKeyOf<CatalogModelRecord>;

export interface CatalogOrderByField {
  readonly field: CatalogSortField;
  readonly direction: SortDirection;
}

export type CatalogOrderBy =
  | CatalogSortField
  | CatalogOrderByField
  | ReadonlyArray<CatalogSortField | CatalogOrderByField>;

export interface CatalogQueryOptions extends Omit<FilterOptions, "orderBy"> {
  readonly orderBy?: CatalogOrderBy;
}

export type SerializableCatalogQueryOptions = Omit<
  CatalogQueryOptions,
  "customComparator"
>;

export interface SerializableCatalogQuery {
  readonly expression: SerializableCatalogQueryExpression;
  readonly options?: SerializableCatalogQueryOptions;
}

interface JsonSchemaNode {
  readonly type?: string | ReadonlyArray<string>;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly items?: JsonSchemaNode;
  readonly oneOf?: ReadonlyArray<JsonSchemaNode>;
  readonly anyOf?: ReadonlyArray<JsonSchemaNode>;
  readonly propertyNames?: JsonSchemaNode;
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly enum?: ReadonlyArray<unknown>;
  readonly minLength?: number;
  readonly pattern?: string;
}

const catalogRecordJsonSchema = z.toJSONSchema(
  CatalogModelRecordSchema,
) as JsonSchemaNode;
const jsonValueSchema = z.json();

const operatorSchemas = {
  $gt: z.number(),
  $gte: z.number(),
  $lt: z.number(),
  $lte: z.number(),
  $eq: jsonValueSchema,
  $ne: jsonValueSchema,
  $in: z.array(jsonValueSchema),
  $nin: z.array(jsonValueSchema),
  $contains: jsonValueSchema,
  $size: z.number().int().nonnegative(),
  $startsWith: z.string(),
  $endsWith: z.string(),
  $regex: z.string(),
  $match: z.string(),
} satisfies Readonly<Record<string, z.ZodType>>;

type OperatorName = keyof typeof operatorSchemas;

const serializableExpressionSchema = z
  .unknown()
  .superRefine((value, context) => {
    validateCatalogExpression(value, [catalogRecordJsonSchema], context, []);
  })
  .transform(value => value as SerializableCatalogQueryExpression);

const catalogSortFieldSchema = z
  .string()
  .superRefine((field, context) => {
    if (!isCatalogPath(field, [catalogRecordJsonSchema])) {
      context.addIssue({
        code: "custom",
        message: `Unknown catalog sort field: ${field}`,
      });
    }
  })
  .transform(field => field as CatalogSortField);

const catalogOrderByFieldSchema = z.object({
  field: catalogSortFieldSchema,
  direction: z.enum(["asc", "desc"]),
});

const catalogOrderBySchema = z.union([
  catalogSortFieldSchema,
  catalogOrderByFieldSchema,
  z.array(z.union([catalogSortFieldSchema, catalogOrderByFieldSchema])),
]);

export const SerializableCatalogQueryOptionsSchema = z
  .object({
    caseSensitive: z.boolean().optional(),
    maxDepth: z.number().int().min(1).max(10).optional(),
    enableCache: z.boolean().optional(),
    enablePerformanceMonitoring: z.boolean().optional(),
    debug: z.boolean().optional(),
    verbose: z.boolean().optional(),
    showTimings: z.boolean().optional(),
    colorize: z.boolean().optional(),
    orderBy: catalogOrderBySchema.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict()
  .transform(options => options as SerializableCatalogQueryOptions);

export const SerializableCatalogQuerySchema = z
  .object({
    expression: serializableExpressionSchema,
    options: SerializableCatalogQueryOptionsSchema.optional(),
  })
  .strict()
  .transform(query => query as SerializableCatalogQuery);

export function parseCatalogQuery(value: string | unknown): SerializableCatalogQuery {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return SerializableCatalogQuerySchema.parse(parsed);
}

export function serializeCatalogQuery(query: SerializableCatalogQuery): string {
  return JSON.stringify(SerializableCatalogQuerySchema.parse(query));
}

export function queryCatalogModels(
  models: Readonly<Record<string, CatalogModel>>,
  expression: CatalogQuery = () => true,
  options: CatalogQueryOptions = {},
): CatalogModelRecord[] {
  const records = Object.entries(models).map(([id, model]) => ({ id, ...model }));
  const predicate =
    typeof expression === "function"
      ? expression
      : (record: CatalogModelRecord) =>
          matchesCatalogValue(record, expression, predicateOptions(options));
  return filter(
    records,
    predicate,
    options as FilterOptions,
  );
}

function matchesCatalogValue(
  actual: unknown,
  expression: unknown,
  options: FilterOptions,
): boolean {
  if (isFieldOperatorExpression(expression)) {
    return matchesWithFilter(actual, expression, options);
  }

  if (Array.isArray(actual)) {
    const expressions = Array.isArray(expression) ? expression : [expression];
    return actual.some(item =>
      expressions.some(itemExpression =>
        matchesCatalogValue(item, itemExpression, options),
      ),
    );
  }

  if (isPlainObject(expression)) {
    if (!isPlainObject(actual)) return false;

    return Object.entries(expression).every(([key, fieldExpression]) => {
      if (key === "$and") {
        return (
          Array.isArray(fieldExpression) &&
          fieldExpression.every(childExpression =>
            matchesCatalogValue(actual, childExpression, options),
          )
        );
      }
      if (key === "$or") {
        return (
          Array.isArray(fieldExpression) &&
          fieldExpression.some(childExpression =>
            matchesCatalogValue(actual, childExpression, options),
          )
        );
      }
      if (key === "$not") {
        return !matchesCatalogValue(actual, fieldExpression, options);
      }
      return matchesCatalogValue(actual[key], fieldExpression, options);
    });
  }

  return matchesWithFilter(actual, expression, options);
}

function matchesWithFilter(
  actual: unknown,
  expression: unknown,
  options: FilterOptions,
): boolean {
  if (
    isPlainObject(actual) &&
    !isPlainObject(expression) &&
    !Array.isArray(expression)
  ) {
    return filter(
      [actual],
      expression as Expression<Readonly<Record<string, unknown>>>,
      options,
    ).length > 0;
  }

  return filter(
    [{ value: actual }],
    { value: expression } as Expression<{ readonly value: unknown }>,
    options,
  ).length > 0;
}

function predicateOptions(options: CatalogQueryOptions): FilterOptions {
  const result: FilterOptions = { enableCache: false };
  if (options.caseSensitive !== undefined) {
    result.caseSensitive = options.caseSensitive;
  }
  if (options.maxDepth !== undefined) result.maxDepth = options.maxDepth;
  if (options.customComparator !== undefined) {
    result.customComparator = options.customComparator;
  }
  return result;
}

function validateCatalogExpression(
  value: unknown,
  schemas: ReadonlyArray<JsonSchemaNode>,
  context: z.RefinementCtx,
  path: ReadonlyArray<PropertyKey>,
): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return;
  }

  if (!isPlainObject(value)) {
    context.addIssue({
      code: "custom",
      message: "Catalog queries must be JSON primitives or objects.",
      path: [...path],
    });
    return;
  }

  for (const [key, fieldExpression] of Object.entries(value)) {
    const fieldPath = [...path, key];

    if (key === "$and" || key === "$or") {
      if (!Array.isArray(fieldExpression) || fieldExpression.length === 0) {
        context.addIssue({
          code: "custom",
          message: `${key} requires a non-empty array of expressions.`,
          path: fieldPath,
        });
        continue;
      }
      fieldExpression.forEach((expression, index) => {
        validateCatalogExpression(expression, schemas, context, [
          ...fieldPath,
          index,
        ]);
      });
      continue;
    }

    if (key === "$not") {
      validateCatalogExpression(fieldExpression, schemas, context, fieldPath);
      continue;
    }

    if (key.startsWith("$")) {
      context.addIssue({
        code: "custom",
        message: `Unknown logical operator: ${key}`,
        path: fieldPath,
      });
      continue;
    }

    const fieldSchemas = getChildSchemas(schemas, key);
    if (fieldSchemas.length === 0) {
      context.addIssue({
        code: "custom",
        message: `Unknown catalog field: ${formatPath(fieldPath)}`,
        path: fieldPath,
      });
      continue;
    }

    if (isOperatorExpression(fieldExpression)) {
      validateOperatorExpression(fieldExpression, context, fieldPath);
      continue;
    }

    if (isPlainObject(fieldExpression)) {
      const nestedSchemas = fieldSchemas
        .flatMap(schema => unwrapArraySchemas(schema))
        .filter(schema => schemaSupportsObject(schema));
      if (nestedSchemas.length === 0) {
        context.addIssue({
          code: "custom",
          message: `Field ${formatPath(fieldPath)} does not support nested queries.`,
          path: fieldPath,
        });
        continue;
      }
      validateCatalogExpression(
        fieldExpression,
        nestedSchemas,
        context,
        fieldPath,
      );
      continue;
    }

    if (Array.isArray(fieldExpression)) {
      const itemSchemas = fieldSchemas.flatMap(schema => unwrapArraySchemas(schema));
      if (itemSchemas.some(schema => schemaSupportsObject(schema))) {
        fieldExpression.forEach((itemExpression, index) => {
          if (isPlainObject(itemExpression)) {
            validateCatalogExpression(itemExpression, itemSchemas, context, [
              ...fieldPath,
              index,
            ]);
          }
        });
      }
    }

    const literalResult = jsonValueSchema.safeParse(fieldExpression);
    if (!literalResult.success) {
      context.addIssue({
        code: "custom",
        message: `Field ${formatPath(fieldPath)} must use a JSON-compatible value.`,
        path: fieldPath,
      });
    }
  }
}

function validateOperatorExpression(
  expression: Readonly<Record<string, unknown>>,
  context: z.RefinementCtx,
  path: ReadonlyArray<PropertyKey>,
): void {
  for (const [operator, operand] of Object.entries(expression)) {
    if (!(operator in operatorSchemas)) {
      context.addIssue({
        code: "custom",
        message: `Unknown filter operator: ${operator}`,
        path: [...path, operator],
      });
      continue;
    }

    const result = operatorSchemas[operator as OperatorName].safeParse(operand);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        message: `Invalid operand for ${operator}.`,
        path: [...path, operator],
      });
    }
  }
}

function getChildSchemas(
  schemas: ReadonlyArray<JsonSchemaNode>,
  key: string,
): JsonSchemaNode[] {
  return schemas.flatMap(schema => {
    const variants = expandSchema(schema);
    return variants.flatMap(variant => {
      const property = variant.properties?.[key];
      if (property) return [property];

      if (
        typeof variant.additionalProperties === "object" &&
        matchesPropertyName(key, variant.propertyNames)
      ) {
        return [variant.additionalProperties];
      }

      return [];
    });
  });
}

function isCatalogPath(
  path: string,
  schemas: ReadonlyArray<JsonSchemaNode>,
): boolean {
  if (path.length === 0) return false;

  let currentSchemas = [...schemas];
  for (const segment of path.split(".")) {
    currentSchemas = getChildSchemas(
      currentSchemas.flatMap(schema => unwrapArraySchemas(schema)),
      segment,
    );
    if (currentSchemas.length === 0) return false;
  }
  return true;
}

function unwrapArraySchemas(schema: JsonSchemaNode): JsonSchemaNode[] {
  return expandSchema(schema).flatMap(variant =>
    variant.type === "array" && variant.items ? expandSchema(variant.items) : [variant],
  );
}

function expandSchema(schema: JsonSchemaNode): JsonSchemaNode[] {
  const variants = schema.oneOf ?? schema.anyOf;
  return variants ? variants.flatMap(variant => expandSchema(variant)) : [schema];
}

function schemaSupportsObject(schema: JsonSchemaNode): boolean {
  return expandSchema(schema).some(
    variant =>
      variant.type === "object" ||
      variant.properties !== undefined ||
      typeof variant.additionalProperties === "object",
  );
}

function matchesPropertyName(
  value: string,
  schema: JsonSchemaNode | undefined,
): boolean {
  if (!schema) return true;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.minLength !== undefined && value.length < schema.minLength) return false;
  return schema.pattern === undefined || new RegExp(schema.pattern).test(value);
}

function isOperatorExpression(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return isPlainObject(value) && Object.keys(value).some(key => key.startsWith("$"));
}

function isFieldOperatorExpression(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every(key => key in operatorSchemas);
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.map(String).join(".");
}
