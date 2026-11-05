from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping, Sequence
from functools import cmp_to_key
from importlib.resources import files
from typing import Any, Literal, TypeAlias

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    model_validator,
)

from .models import CatalogModelRecord

CatalogQueryExpression: TypeAlias = Mapping[str, JsonValue]
CatalogPredicate: TypeAlias = Callable[[CatalogModelRecord], bool]
CatalogQuery: TypeAlias = CatalogQueryExpression | CatalogPredicate
SortDirection: TypeAlias = Literal["asc", "desc"]

_OPERATORS = {
    "$gt",
    "$gte",
    "$lt",
    "$lte",
    "$eq",
    "$ne",
    "$in",
    "$nin",
    "$contains",
    "$size",
    "$startsWith",
    "$endsWith",
    "$regex",
    "$match",
}
_LOGICAL_OPERATORS = {"$and", "$or", "$not"}
_NUMBER_OPERATORS = {"$gt", "$gte", "$lt", "$lte"}
_STRING_OPERATORS = {"$startsWith", "$endsWith", "$regex", "$match"}
_ARRAY_OPERATORS = {"$in", "$nin"}


class CatalogOrderByField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    direction: SortDirection


CatalogOrderBy: TypeAlias = (
    str
    | CatalogOrderByField
    | Sequence[str | CatalogOrderByField | Mapping[str, str]]
    | Mapping[str, str]
)


class CatalogQueryOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    case_sensitive: bool = Field(
        default=False,
        validation_alias=AliasChoices("case_sensitive", "caseSensitive"),
        serialization_alias="caseSensitive",
    )
    max_depth: int = Field(
        default=3,
        ge=0,
        validation_alias=AliasChoices("max_depth", "maxDepth"),
        serialization_alias="maxDepth",
    )
    order_by: CatalogOrderBy | None = Field(
        default=None,
        validation_alias=AliasChoices("order_by", "orderBy"),
        serialization_alias="orderBy",
    )
    limit: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def validate_order_by(self) -> CatalogQueryOptions:
        for order in _normalize_order_by(self.order_by):
            _validate_sort_field(order.field)
        return self


class SerializableCatalogQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expression: dict[str, JsonValue]
    options: CatalogQueryOptions | None = None

    @model_validator(mode="after")
    def validate_expression(self) -> SerializableCatalogQuery:
        _validate_expression(self.expression, [_record_schema()], [])
        return self


def parse_catalog_query(value: str | Mapping[str, object]) -> SerializableCatalogQuery:
    parsed = json.loads(value) if isinstance(value, str) else value
    return SerializableCatalogQuery.model_validate(parsed)


def serialize_catalog_query(query: SerializableCatalogQuery | Mapping[str, object]) -> str:
    parsed = SerializableCatalogQuery.model_validate(query)
    return parsed.model_dump_json(
        by_alias=True,
        exclude_none=True,
        exclude_unset=True,
    )


def query_catalog_records(
    records: Sequence[CatalogModelRecord],
    expression: CatalogQuery | None = None,
    options: CatalogQueryOptions | Mapping[str, object] | None = None,
) -> list[CatalogModelRecord]:
    parsed_options = CatalogQueryOptions.model_validate(options or {})
    predicate = expression or (lambda _: True)
    if not callable(predicate):
        _validate_expression(predicate, [_record_schema()], [])

    result = [
        record
        for record in records
        if (
            predicate(record)
            if callable(predicate)
            else _matches_value(
                record.model_dump(mode="json"),
                predicate,
                parsed_options.case_sensitive,
            )
        )
    ]

    order_by = _normalize_order_by(parsed_options.order_by)
    if order_by:
        result.sort(
            key=cmp_to_key(
                lambda left, right: _compare_records(
                    left,
                    right,
                    order_by,
                    parsed_options.case_sensitive,
                )
            )
        )
    if parsed_options.limit is not None:
        result = result[: parsed_options.limit]
    return result


def _matches_value(actual: object, expression: object, case_sensitive: bool) -> bool:
    if _is_field_operator_expression(expression):
        return _matches_operators(actual, expression, case_sensitive)

    if isinstance(actual, list):
        expressions = expression if isinstance(expression, list) else [expression]
        return any(
            _matches_value(item, item_expression, case_sensitive)
            for item in actual
            for item_expression in expressions
        )

    if isinstance(expression, Mapping):
        if not isinstance(actual, Mapping):
            return False
        for key, field_expression in expression.items():
            if key == "$and":
                if not isinstance(field_expression, list) or not all(
                    _matches_value(actual, child, case_sensitive)
                    for child in field_expression
                ):
                    return False
            elif key == "$or":
                if not isinstance(field_expression, list) or not any(
                    _matches_value(actual, child, case_sensitive)
                    for child in field_expression
                ):
                    return False
            elif key == "$not":
                if _matches_value(actual, field_expression, case_sensitive):
                    return False
            elif not _matches_value(
                actual.get(key), field_expression, case_sensitive
            ):
                return False
        return True

    if isinstance(expression, list):
        return any(
            _matches_array_alternative(actual, alternative, case_sensitive)
            for alternative in expression
        )
    return _matches_literal(actual, expression, case_sensitive)


def _matches_operators(
    actual: object,
    operators: Mapping[str, object],
    case_sensitive: bool,
) -> bool:
    if "$eq" in operators and actual != operators["$eq"]:
        return False
    if "$ne" in operators and actual == operators["$ne"]:
        return False

    for operator in _NUMBER_OPERATORS:
        if operator not in operators:
            continue
        if not isinstance(actual, (int, float)) or isinstance(actual, bool):
            return False
        operand = operators[operator]
        if not isinstance(operand, (int, float)) or isinstance(operand, bool):
            return False
        if operator == "$gt" and not actual > operand:
            return False
        if operator == "$gte" and not actual >= operand:
            return False
        if operator == "$lt" and not actual < operand:
            return False
        if operator == "$lte" and not actual <= operand:
            return False

    if "$in" in operators and not any(
        actual == candidate for candidate in operators["$in"]  # type: ignore[union-attr]
    ):
        return False
    if "$nin" in operators and any(
        actual == candidate for candidate in operators["$nin"]  # type: ignore[union-attr]
    ):
        return False

    if "$size" in operators:
        if not isinstance(actual, list) or len(actual) != operators["$size"]:
            return False

    if "$contains" in operators:
        operand = operators["$contains"]
        if isinstance(actual, str) and isinstance(operand, str):
            source, target = _string_pair(actual, operand, case_sensitive)
            if target not in source:
                return False
        elif isinstance(actual, list):
            if not any(candidate == operand for candidate in actual):
                return False
        else:
            return False

    for operator, method in (
        ("$startsWith", str.startswith),
        ("$endsWith", str.endswith),
    ):
        if operator in operators:
            operand = operators[operator]
            if not isinstance(actual, str) or not isinstance(operand, str):
                return False
            source, target = _string_pair(actual, operand, case_sensitive)
            if not method(source, target):
                return False

    for operator in ("$regex", "$match"):
        if operator in operators:
            operand = operators[operator]
            if not isinstance(actual, str) or not isinstance(operand, str):
                return False
            flags = 0 if case_sensitive else re.IGNORECASE
            if re.search(operand, actual, flags) is None:
                return False
    return True


def _matches_array_alternative(
    actual: object, alternative: object, case_sensitive: bool
) -> bool:
    if isinstance(alternative, str) and ("%" in alternative or "_" in alternative):
        return _matches_wildcard(actual, alternative, case_sensitive)
    return actual == alternative


def _matches_literal(actual: object, expression: object, case_sensitive: bool) -> bool:
    negate = isinstance(expression, str) and expression.startswith("!")
    candidate = expression[1:] if negate else expression
    if isinstance(candidate, str) and ("%" in candidate or "_" in candidate):
        matches = _matches_wildcard(actual, candidate, case_sensitive)
    elif isinstance(actual, str) and isinstance(candidate, str) and not case_sensitive:
        matches = actual.casefold() == candidate.casefold()
    else:
        matches = actual == candidate
    return not matches if negate else matches


def _matches_wildcard(actual: object, pattern: str, case_sensitive: bool) -> bool:
    if not isinstance(actual, str):
        return False
    escaped = re.escape(pattern).replace("%", ".*").replace("_", ".")
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.fullmatch(escaped, actual, flags) is not None


def _string_pair(left: str, right: str, case_sensitive: bool) -> tuple[str, str]:
    return (left, right) if case_sensitive else (left.casefold(), right.casefold())


def _normalize_order_by(order_by: CatalogOrderBy | None) -> list[CatalogOrderByField]:
    if order_by is None:
        return []
    if isinstance(order_by, str):
        return [CatalogOrderByField(field=order_by, direction="asc")]
    if isinstance(order_by, (CatalogOrderByField, Mapping)):
        return [CatalogOrderByField.model_validate(order_by)]
    return [
        CatalogOrderByField(field=item, direction="asc")
        if isinstance(item, str)
        else CatalogOrderByField.model_validate(item)
        for item in order_by
    ]


def _compare_records(
    left: CatalogModelRecord,
    right: CatalogModelRecord,
    order_by: Sequence[CatalogOrderByField],
    case_sensitive: bool,
) -> int:
    for order in order_by:
        comparison = _compare_values(
            _nested_value(left, order.field),
            _nested_value(right, order.field),
            order.direction,
            case_sensitive,
        )
        if comparison:
            return comparison
    return 0


def _nested_value(value: object, path: str) -> object:
    current = value.model_dump(mode="json") if isinstance(value, BaseModel) else value
    for key in path.split("."):
        if not isinstance(current, Mapping):
            return None
        current = current.get(key)
    return current


def _compare_values(
    left: object,
    right: object,
    direction: SortDirection,
    case_sensitive: bool,
) -> int:
    if left is None:
        return 1
    if right is None:
        return -1
    if left == right:
        return 0
    if isinstance(left, str) and isinstance(right, str) and not case_sensitive:
        left, right = left.casefold(), right.casefold()
    try:
        comparison = -1 if left < right else 1  # type: ignore[operator]
    except TypeError:
        comparison = -1 if str(left) < str(right) else 1
    return comparison if direction == "asc" else -comparison


def _validate_expression(
    value: object,
    schemas: Sequence[Mapping[str, object]],
    path: list[str | int],
) -> None:
    if value is None or isinstance(value, (str, int, float, bool)):
        return
    if not isinstance(value, Mapping):
        raise ValueError(f"Catalog queries must be JSON primitives or objects at {_path(path)}")

    for key, field_expression in value.items():
        field_path = [*path, key]
        if key in {"$and", "$or"}:
            if not isinstance(field_expression, list) or not field_expression:
                raise ValueError(f"{key} requires a non-empty array of expressions")
            for index, child in enumerate(field_expression):
                _validate_expression(child, schemas, [*field_path, index])
            continue
        if key == "$not":
            _validate_expression(field_expression, schemas, field_path)
            continue
        if key.startswith("$"):
            raise ValueError(f"Unknown logical operator: {key}")

        field_schemas = _child_schemas(schemas, key)
        if not field_schemas:
            raise ValueError(f"Unknown catalog field: {_path(field_path)}")
        if _has_operator_key(field_expression):
            _validate_operators(field_expression)
            continue
        if isinstance(field_expression, Mapping):
            nested = [
                schema
                for field_schema in field_schemas
                for schema in _unwrap_array_schemas(field_schema)
                if _supports_object(schema)
            ]
            if not nested:
                raise ValueError(
                    f"Field {_path(field_path)} does not support nested queries"
                )
            _validate_expression(field_expression, nested, field_path)
            continue
        if isinstance(field_expression, list):
            item_schemas = [
                schema
                for field_schema in field_schemas
                for schema in _unwrap_array_schemas(field_schema)
            ]
            if any(_supports_object(schema) for schema in item_schemas):
                for index, item in enumerate(field_expression):
                    if isinstance(item, Mapping):
                        _validate_expression(item, item_schemas, [*field_path, index])
        try:
            json.dumps(field_expression)
        except (TypeError, ValueError) as error:
            raise ValueError(
                f"Field {_path(field_path)} must use a JSON-compatible value"
            ) from error


def _validate_operators(operators: Mapping[str, object]) -> None:
    for operator, operand in operators.items():
        if operator not in _OPERATORS:
            raise ValueError(f"Unknown filter operator: {operator}")
        if operator in _NUMBER_OPERATORS and not _is_number(operand):
            raise ValueError(f"Invalid operand for {operator}")
        if operator in _ARRAY_OPERATORS and not isinstance(operand, list):
            raise ValueError(f"Invalid operand for {operator}")
        if operator == "$size" and (
            not isinstance(operand, int) or isinstance(operand, bool) or operand < 0
        ):
            raise ValueError(f"Invalid operand for {operator}")
        if operator in _STRING_OPERATORS and not isinstance(operand, str):
            raise ValueError(f"Invalid operand for {operator}")
        try:
            json.dumps(operand)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Invalid operand for {operator}") from error


def _validate_sort_field(field: str) -> None:
    if not field or not _is_catalog_path(field, [_record_schema()]):
        raise ValueError(f"Unknown catalog sort field: {field}")


def _is_catalog_path(path: str, schemas: Sequence[Mapping[str, object]]) -> bool:
    current = list(schemas)
    for segment in path.split("."):
        current = _child_schemas(
            [
                schema
                for current_schema in current
                for schema in _unwrap_array_schemas(current_schema)
            ],
            segment,
        )
        if not current:
            return False
    return True


def _child_schemas(
    schemas: Sequence[Mapping[str, object]], key: str
) -> list[Mapping[str, object]]:
    result: list[Mapping[str, object]] = []
    for schema in schemas:
        for variant in _expand_schema(schema):
            properties = variant.get("properties")
            if isinstance(properties, Mapping) and isinstance(properties.get(key), Mapping):
                result.append(properties[key])  # type: ignore[arg-type]
                continue
            additional = variant.get("additionalProperties")
            if isinstance(additional, Mapping) and _matches_property_name(
                key, variant.get("propertyNames")
            ):
                result.append(additional)
    return result


def _unwrap_array_schemas(
    schema: Mapping[str, object],
) -> list[Mapping[str, object]]:
    result: list[Mapping[str, object]] = []
    for variant in _expand_schema(schema):
        items = variant.get("items")
        if variant.get("type") == "array" and isinstance(items, Mapping):
            result.extend(_expand_schema(items))
        else:
            result.append(variant)
    return result


def _expand_schema(schema: Mapping[str, object]) -> list[Mapping[str, object]]:
    variants = schema.get("oneOf") or schema.get("anyOf")
    if not isinstance(variants, list):
        return [schema]
    return [
        expanded
        for variant in variants
        if isinstance(variant, Mapping)
        for expanded in _expand_schema(variant)
    ]


def _supports_object(schema: Mapping[str, object]) -> bool:
    return any(
        variant.get("type") == "object"
        or "properties" in variant
        or isinstance(variant.get("additionalProperties"), Mapping)
        for variant in _expand_schema(schema)
    )


def _matches_property_name(key: str, schema: object) -> bool:
    if not isinstance(schema, Mapping):
        return True
    enum = schema.get("enum")
    if isinstance(enum, list) and key not in enum:
        return False
    minimum = schema.get("minLength")
    if isinstance(minimum, int) and len(key) < minimum:
        return False
    pattern = schema.get("pattern")
    return not isinstance(pattern, str) or re.search(pattern, key) is not None


def _has_operator_key(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and bool(value)
        and any(key.startswith("$") for key in value)
    )


def _is_field_operator_expression(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and bool(value)
        and all(key in _OPERATORS for key in value)
    )


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _path(path: Sequence[str | int]) -> str:
    return ".".join(str(item) for item in path) or "<root>"


def _record_schema() -> Mapping[str, object]:
    schema = _catalog_schema()["$defs"]["CatalogModel"]
    record = json.loads(json.dumps(schema))
    properties = record.setdefault("properties", {})
    properties["id"] = {"type": "string", "minLength": 1}
    record.setdefault("required", []).append("id")
    return record


def _catalog_schema() -> dict[str, Any]:
    if not hasattr(_catalog_schema, "value"):
        schema_file = files("dbx_model_catalog.schema").joinpath(
            "model-catalog.schema.json"
        )
        _catalog_schema.value = json.loads(schema_file.read_text())  # type: ignore[attr-defined]
    return _catalog_schema.value  # type: ignore[attr-defined,no-any-return]


__all__ = [
    "CatalogOrderBy",
    "CatalogOrderByField",
    "CatalogPredicate",
    "CatalogQuery",
    "CatalogQueryExpression",
    "CatalogQueryOptions",
    "SerializableCatalogQuery",
    "parse_catalog_query",
    "query_catalog_records",
    "serialize_catalog_query",
]
