from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from .models import Status, Type

CapabilityName = Literal[
    "apply-patch",
    "attachments",
    "reasoning",
    "responses",
    "structured-output",
    "tools",
    "web-search",
]


def _trim_to_none(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = value.strip()
    return value or None


OptionalTrimmedString = Annotated[
    str | None,
    BeforeValidator(_trim_to_none),
]


class CatalogFilters(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    query: OptionalTrimmedString = None
    status: list[Status] = Field(default_factory=list)
    model_type: list[Type] = Field(default_factory=list, alias="type")
    publisher: list[str] = Field(default_factory=list)
    task: list[str] = Field(default_factory=list)
    capability: list[CapabilityName] = Field(default_factory=list)
    limit: int | None = Field(default=50, ge=0, le=1_000)


__all__ = ["CapabilityName", "CatalogFilters"]
