import os
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Literal

from chanx.core.decorators import channel, ws_handler
from chanx.fast_channels import asyncapi_docs, asyncapi_spec_json
from chanx.fast_channels.type_defs import AsyncAPIConfig
from chanx.messages.base import BaseMessage
from dbx_model_catalog import (
    CatalogFilters,
    CatalogModelRecord,
    ModelCatalog,
    ModelCatalogClient,
)
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pynect import AsyncJsonWebsocketConsumer


class GetCatalogRequest(BaseMessage):
    action: Literal["get_catalog"] = "get_catalog"
    payload: CatalogFilters


class GetCatalogResponse(BaseMessage):
    action: Literal["catalog"] = "catalog"
    payload: ModelCatalog


class ListModelsRequest(BaseMessage):
    action: Literal["list_models"] = "list_models"
    payload: CatalogFilters


class ListModelsResponse(BaseMessage):
    action: Literal["models"] = "models"
    payload: list[CatalogModelRecord]


class StreamModelsRequest(BaseMessage):
    action: Literal["stream_models"] = "stream_models"
    payload: CatalogFilters


class StreamModelsResponse(BaseMessage):
    action: Literal["model"] = "model"
    payload: CatalogModelRecord


def _catalog_path() -> Path | None:
    configured = os.environ.get("DBX_MODEL_CATALOG_PATH")
    return Path(configured).expanduser().resolve() if configured else None


def _catalog_service() -> ModelCatalogClient:
    path = _catalog_path()
    return (
        ModelCatalogClient.from_json(path.read_bytes())
        if path is not None
        else ModelCatalogClient.from_published()
    )


catalog = _catalog_service()


@channel(name="models", description="Read and filter the model catalog")
class ModelsConsumer(AsyncJsonWebsocketConsumer):
    @ws_handler
    async def get_catalog(self, _message: GetCatalogRequest) -> GetCatalogResponse:
        return GetCatalogResponse(payload=catalog.catalog)

    @ws_handler
    async def list_models(self, message: ListModelsRequest) -> ListModelsResponse:
        return ListModelsResponse(payload=catalog.filter(message.payload))

    @ws_handler
    async def stream_models(
        self,
        message: StreamModelsRequest,
    ) -> AsyncIterator[StreamModelsResponse]:
        for model in catalog.filter(message.payload):
            yield StreamModelsResponse(payload=model)


app = FastAPI(title="dbx-model-catalog", version="1.0.0")
app.router.add_websocket_route("/ws/models", ModelsConsumer.as_asgi())

asyncapi_config = AsyncAPIConfig(
    description="Python-owned dbx-model-catalog API",
    version="1.0.0",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/asyncapi")
async def asyncapi_documentation(request: Request) -> HTMLResponse:
    return await asyncapi_docs(request=request, app=app, config=asyncapi_config)


@app.get("/asyncapi.json")
async def asyncapi_json(request: Request) -> JSONResponse:
    return await asyncapi_spec_json(
        request=request,
        app=app,
        config=asyncapi_config,
    )


web_directory = (
    Path(__file__).resolve().parents[5]
    / "packages"
    / "js"
    / "web"
    / "dist"
)
if (web_directory / "index.html").is_file():
    app.mount("/", StaticFiles(directory=web_directory, html=True), name="web")
