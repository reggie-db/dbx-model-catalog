from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .utilities import parse_flexible_date

T = TypeVar("T")
ModelSource = Literal["models.dev", "modelparams.dev", "lm-arena", "livebench", "databricks"]


class LooseModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class SyncResult(BaseModel, Generic[T]):
    source: ModelSource
    fetched_at: datetime = Field(alias="fetchedAt")
    data: T


class ModelsDevLimit(LooseModel):
    context: int
    output: int
    input: int | None = None


class ModelsDevModalities(LooseModel):
    input: list[str]
    output: list[str]


class ModelsDevModel(LooseModel):
    id: str
    name: str
    description: str
    attachment: bool
    reasoning: bool
    tool_call: bool
    release_date: datetime
    last_updated: datetime
    modalities: ModelsDevModalities
    open_weights: bool
    limit: ModelsDevLimit
    family: str | None = None
    canonical_model_id: str | None = None
    status: str | None = None
    type: str | None = None
    cost: dict[str, Any] | None = None
    reasoning_options: list[dict[str, Any]] | None = None
    structured_output: bool | None = None
    temperature: bool | None = None
    knowledge: datetime | None = None

    @field_validator("release_date", "last_updated", "knowledge", mode="before")
    @classmethod
    def parse_dates(cls, value: object) -> object:
        return None if value is None else parse_flexible_date(value)  # type: ignore[arg-type]


class ModelsDevProvider(LooseModel):
    id: str
    env: list[str]
    npm: str
    name: str
    doc: str
    models: dict[str, ModelsDevModel]


ModelsDevData = dict[str, ModelsDevProvider]


class ModelParam(LooseModel):
    path: str
    label: str
    description: str
    group: str
    type: str
    range: dict[str, float] | None = None


class ModelParamsModel(LooseModel):
    provider: str
    auth_type: str = Field(alias="authType")
    api_surface: str = Field(alias="apiSurface")
    model: str
    params: list[ModelParam]
    status: str | None = None
    replacement: str | None = None
    shutdown_on: datetime | None = Field(default=None, alias="shutdownOn")

    @field_validator("shutdown_on", mode="before")
    @classmethod
    def parse_shutdown(cls, value: object) -> object:
        return None if value is None else parse_flexible_date(value)  # type: ignore[arg-type]


class ModelParamsData(LooseModel):
    schema_url: str = Field(alias="$schema")
    generated_at: datetime = Field(alias="generatedAt")
    count: int
    models: list[ModelParamsModel]

    @field_validator("generated_at", mode="before")
    @classmethod
    def parse_generated_at(cls, value: object) -> object:
        return parse_flexible_date(value)  # type: ignore[arg-type]


class LMArenaRow(LooseModel):
    model_name: str
    source_url: str | None = Field(default=None, alias="sourceUrl")
    organization: str | None = None
    license: str | None = None
    rank: int | None = None
    leaderboard_publish_date: datetime | None = None
    rating: float | None = None
    rating_lower: float | None = None
    rating_upper: float | None = None
    variance: float | None = None
    vote_count: int | None = None
    score: float | None = None
    score_ci_lower: float | None = None
    score_ci_upper: float | None = None
    observation_count: int | None = None
    session_count: int | None = None
    category: str | None = None

    @field_validator("rank", "vote_count", "observation_count", "session_count", mode="before")
    @classmethod
    def parse_integer(cls, value: object) -> object:
        return None if value in (None, "") else int(value)  # type: ignore[arg-type]

    @field_validator("leaderboard_publish_date", mode="before")
    @classmethod
    def parse_date(cls, value: object) -> object:
        return None if value is None else parse_flexible_date(value)  # type: ignore[arg-type]


class LMArenaConfiguration(LooseModel):
    rows: list[LMArenaRow]


class LMArenaCatalogData(LooseModel):
    dataset: str
    split: str
    metadata: list[dict[str, Any]]
    configurations: dict[str, LMArenaConfiguration]


class LiveBenchRow(LooseModel):
    model: str
    source_url: str | None = Field(default=None, alias="sourceUrl")
    scores: dict[str, float | None]


class LiveBenchCatalogData(LooseModel):
    dataset: str
    release: str
    source_url: str | None = Field(default=None, alias="sourceUrl")
    metadata: list[dict[str, Any]]
    categories: dict[str, list[str]]
    rows: list[LiveBenchRow]


class DatabricksNotice(LooseModel):
    kind: str
    text: str
    links: list[dict[str, str]] = Field(default_factory=list)


class DatabricksReasoning(LooseModel):
    type: str
    details: str
    parameters: str
    levels: list[str] = Field(default_factory=list)


class DatabricksRetirementSchedule(LooseModel):
    offering: str
    dates: list[datetime]
    replacement: str | None = None

    @field_validator("dates", mode="before")
    @classmethod
    def parse_dates(cls, value: object) -> object:
        return [parse_flexible_date(item) for item in value]  # type: ignore[union-attr]


class DatabricksSupportedModel(LooseModel):
    section_id: str = Field(alias="sectionId")
    name: str
    publisher: str | None = None
    service_name: str | None = Field(default=None, alias="serviceName")
    endpoint_name: str | None = Field(default=None, alias="endpointName")
    supported_inputs: list[str] = Field(default_factory=list, alias="supportedInputs")
    status: str | None = None
    description: str = ""
    paragraphs: list[str] = Field(default_factory=list)
    notices: list[DatabricksNotice] = Field(default_factory=list)
    links: list[dict[str, str]] = Field(default_factory=list)
    task_types: list[str] = Field(default_factory=list, alias="taskTypes")
    use_cases: list[str] = Field(default_factory=list, alias="useCases")
    reasoning: DatabricksReasoning | None = None
    web_search: bool = Field(default=False, alias="webSearch")
    deprecated: bool = False
    retirements: list[DatabricksRetirementSchedule] = Field(default_factory=list)
    pricing: list[dict[str, Any]] = Field(default_factory=list)


class DatabricksPageMetadata(LooseModel):
    source_url: str = Field(alias="sourceUrl")
    title: str
    description: str | None = None
    modified_at: str | None = Field(default=None, alias="modifiedAt")


class DatabricksSupportedModelsPage(LooseModel):
    metadata: DatabricksPageMetadata
    introduction: list[str]
    models: list[DatabricksSupportedModel]
    additional_resources: list[dict[str, str]] = Field(default_factory=list, alias="additionalResources")


class DatabricksCloudProviderData(LooseModel):
    cloud_provider: str = Field(alias="cloudProvider")
    supported_models: DatabricksSupportedModelsPage = Field(alias="supportedModels")
    score_foundation_models: dict[str, Any] = Field(default_factory=dict, alias="scoreFoundationModels")
    web_search: dict[str, Any] = Field(default_factory=dict, alias="webSearch")
    retired_models_policy: dict[str, Any] = Field(default_factory=dict, alias="retiredModelsPolicy")


class DatabricksPricingCatalog(LooseModel):
    source_urls: list[str] = Field(default_factory=list, alias="sourceUrls")
    default_regions: dict[str, str] = Field(default_factory=dict, alias="defaultRegions")
    usd_per_dbu: dict[str, float] = Field(default_factory=dict, alias="usdPerDbu")
    entries: list[dict[str, Any]] = Field(default_factory=list)


class DatabricksCatalogData(LooseModel):
    pricing: DatabricksPricingCatalog
    cloud_providers: dict[str, DatabricksCloudProviderData] = Field(alias="cloudProviders")
    capabilities: dict[str, list[str]] = Field(default_factory=dict)
    rate_limits: dict[str, dict[str, int | None]] = Field(
        default_factory=dict, alias="rateLimits"
    )
    retired_models: list[dict[str, Any]] = Field(
        default_factory=list, alias="retiredModels"
    )
    latency: dict[str, dict[str, Any]] = Field(default_factory=dict)
