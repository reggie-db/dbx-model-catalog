from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from datetime import date
from pathlib import Path

from pydantic import BaseModel

from .models import ModelCatalog
from .search import CatalogSearchIndexPayload

CATALOG_DATABASE_SCHEMA_VERSION = 1
_APPLICATION_ID = 0x4442584D


def write_catalog_database(
    catalog: ModelCatalog,
    search_index: CatalogSearchIndexPayload,
    path: str | Path,
) -> Path:
    database_path = Path(path)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=database_path.parent,
        prefix=f".{database_path.stem}.",
        suffix=database_path.suffix,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        with sqlite3.connect(temporary_path) as connection:
            _create_schema(connection)
            _populate_database(connection, catalog, search_index)
            connection.commit()
            connection.execute("VACUUM")
        os.replace(temporary_path, database_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return database_path


def _create_schema(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute(f"PRAGMA application_id = {_APPLICATION_ID}")
    connection.execute(f"PRAGMA user_version = {CATALOG_DATABASE_SCHEMA_VERSION}")
    connection.executescript(
        """
        CREATE TABLE metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            publisher TEXT,
            family TEXT,
            status TEXT NOT NULL,
            model_type TEXT NOT NULL,
            release_date TEXT,
            last_updated TEXT,
            context_window INTEGER,
            input_limit INTEGER,
            output_limit INTEGER,
            quality_score REAL NOT NULL,
            record_json TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE INDEX models_name ON models(name);
        CREATE INDEX models_publisher ON models(publisher);
        CREATE INDEX models_family ON models(family);
        CREATE INDEX models_status ON models(status);
        CREATE INDEX models_release_date ON models(release_date);

        CREATE TABLE availability (
            model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
            cloud TEXT NOT NULL,
            status TEXT NOT NULL,
            serving_modes_json TEXT NOT NULL,
            details TEXT,
            PRIMARY KEY (model_id, cloud)
        ) WITHOUT ROWID;

        CREATE TABLE rankings (
            model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            domain TEXT NOT NULL,
            category TEXT NOT NULL,
            rank INTEGER NOT NULL,
            metric TEXT NOT NULL,
            published_at TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (model_id, ordinal)
        ) WITHOUT ROWID;

        CREATE INDEX rankings_lookup
            ON rankings(domain, category, rank, published_at);

        CREATE TABLE benchmarks (
            model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            name TEXT NOT NULL,
            rank INTEGER NOT NULL,
            score REAL NOT NULL,
            task_count INTEGER NOT NULL,
            published_at TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (model_id, ordinal)
        ) WITHOUT ROWID;

        CREATE INDEX benchmarks_lookup
            ON benchmarks(name, rank, published_at);

        CREATE TABLE search_documents (
            model_id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
            exact_identities_json TEXT NOT NULL,
            identities_json TEXT NOT NULL,
            keywords TEXT NOT NULL,
            description TEXT NOT NULL,
            tokens_json TEXT NOT NULL,
            version_json TEXT NOT NULL,
            leaderboard_score REAL NOT NULL,
            benchmark_score REAL NOT NULL,
            version_score REAL NOT NULL,
            freshness_score REAL NOT NULL,
            lifecycle_score REAL NOT NULL
        ) WITHOUT ROWID;

        CREATE VIRTUAL TABLE model_search USING fts5(
            model_id UNINDEXED,
            identities,
            keywords,
            description,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        """
    )


def _populate_database(
    connection: sqlite3.Connection,
    catalog: ModelCatalog,
    search_index: CatalogSearchIndexPayload,
) -> None:
    documents = {document.id: document for document in search_index.documents}
    metadata = {
        "catalog_schema_version": str(catalog.schema_version),
        "database_schema_version": str(CATALOG_DATABASE_SCHEMA_VERSION),
        "model_count": str(len(catalog.models)),
        "search_schema_version": str(search_index.schema_version),
        "updated_at": catalog.updated_at.isoformat(),
    }
    connection.executemany(
        "INSERT INTO metadata(key, value) VALUES (?, ?)",
        sorted(metadata.items()),
    )
    for model_id, model in sorted(catalog.models.items()):
        document = documents[model_id]
        limits = model.limits
        connection.execute(
            """
            INSERT INTO models(
                id, name, publisher, family, status, model_type,
                release_date, last_updated, context_window, input_limit,
                output_limit, quality_score, record_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model_id,
                model.name,
                model.publisher,
                model.family,
                model.status.value,
                model.type.value,
                _date(model.release_date),
                _date(model.last_updated),
                limits.context if limits else None,
                limits.input if limits else None,
                limits.output if limits else None,
                document.quality_score,
                _json({"id": model_id, **model.model_dump(mode="json", by_alias=True)}),
            ),
        )
        connection.executemany(
            """
            INSERT INTO availability(
                model_id, cloud, status, serving_modes_json, details
            ) VALUES (?, ?, ?, ?, ?)
            """,
            [
                (
                    model_id,
                    cloud,
                    availability.status.value,
                    _json([mode.value for mode in availability.serving_modes]),
                    availability.details,
                )
                for cloud, availability in sorted(model.availability.items())
            ],
        )
        connection.executemany(
            """
            INSERT INTO rankings(
                model_id, ordinal, domain, category, rank, metric,
                published_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    model_id,
                    ordinal,
                    ranking.domain,
                    ranking.category,
                    ranking.rank,
                    ranking.metric,
                    _date(ranking.published_at),
                    _json(ranking),
                )
                for ordinal, ranking in enumerate(model.rankings)
            ],
        )
        connection.executemany(
            """
            INSERT INTO benchmarks(
                model_id, ordinal, name, rank, score, task_count,
                published_at, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    model_id,
                    ordinal,
                    benchmark.name,
                    benchmark.rank,
                    benchmark.score,
                    benchmark.task_count,
                    _date(benchmark.published_at),
                    _json(benchmark),
                )
                for ordinal, benchmark in enumerate(model.benchmarks)
            ],
        )
        connection.execute(
            """
            INSERT INTO search_documents(
                model_id, exact_identities_json, identities_json, keywords,
                description, tokens_json, version_json, leaderboard_score,
                benchmark_score, version_score, freshness_score, lifecycle_score
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                model_id,
                _json(document.exact_identities),
                _json(document.identities),
                document.keywords,
                document.description,
                _json(document.tokens),
                _json(document.version),
                document.scores.leaderboard,
                document.scores.benchmark,
                document.scores.version,
                document.scores.freshness,
                document.scores.lifecycle,
            ),
        )
        connection.execute(
            """
            INSERT INTO model_search(model_id, identities, keywords, description)
            VALUES (?, ?, ?, ?)
            """,
            (
                model_id,
                " ".join(document.identities),
                document.keywords,
                document.description,
            ),
        )


def _date(value: date | None) -> str | None:
    return value.isoformat() if value is not None else None


def _json(value: BaseModel | object) -> str:
    payload = (
        value.model_dump(mode="json", by_alias=True)
        if isinstance(value, BaseModel)
        else value
    )
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


__all__ = ["CATALOG_DATABASE_SCHEMA_VERSION", "write_catalog_database"]
