from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable

from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.artifacts import PROVIDER_RESPONSE_FILENAME
from campus_ingestion_core.collection_config import (
    CollectionTruthConfig,
    resolve_collection_truth_config,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.handbook_source_projections import (
    build_declared_projection_processed_keys,
    load_handbook_source_projections_config,
)
from campus_ingestion_core.local_rebuild_support import (
    ALLOWED_REBUILD_IMPORT_MODES,
    DEFAULT_CURRICULUM_PLAN_REPLAY_SOURCE_PDF,
    DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS,
    DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF,
    LocalDataRebuildReport,
    QdrantAdmin,
    QdrantCollectionAdmin,
    RebuildRequest,
    ReplayObjectStore,
    S3ObjectStoreAdmin,
    _build_rebuild_trace_recorder,
    _delete_object_keys,
    _normalize_optional_text,
    _parse_bool,
    _read_default_visibility_scope,
    _read_required_env,
    _read_required_scope_part,
    _run_traced_stage,
    _summarize_rebuild_import_result,
)
from campus_ingestion_core.object_store import (
    DEFAULT_RAW_SOURCE_CHANNEL,
    build_source_model_slug,
    build_source_ocr_artifact_key,
    infer_year_label,
    is_source_object_key,
)
from campus_ingestion_core.raw_ingestion import (
    DEFAULT_ONLINE_OCR_MODEL,
    RawIngestionRequest,
    process_raw_ingestion_job,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.scope_catalog import QdrantIndexBinding, assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import load_split_manifest


def _resolve_target_qdrant_binding(
    *,
    corpus: str,
    collection: str,
) -> QdrantIndexBinding:
    return load_runtime_profile(corpus, collection).qdrant_index_binding


def _resolve_rebuild_target_qdrant_bindings(
    *,
    source: dict[str, str],
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> tuple[QdrantIndexBinding, ...]:
    target_bindings = [
        _resolve_target_qdrant_binding(
            corpus=request.corpus,
            collection=request.collection,
        )
    ]
    if (
        request.import_mode == "provider_response_replay"
        and request.collection == "student_handbook"
    ):
        projections_config = load_handbook_source_projections_config(
            collection_config.source_projections_path
        )
        for projection in projections_config.projections:
            if (
                projection.target_corpus == projections_config.source_corpus
                and projection.target_collection == projections_config.source_collection
            ):
                continue
            target_bindings.append(
                _resolve_target_qdrant_binding(
                    corpus=projection.target_corpus,
                    collection=projection.target_collection,
                )
            )
    if (
        request.import_mode == "provider_response_replay"
        and request.collection == "curriculum_plan"
    ):
        target_bindings.append(
            _resolve_target_qdrant_binding(
                corpus="curriculum",
                collection="course_facts",
            )
        )
        target_bindings.append(
            _resolve_target_qdrant_binding(
                corpus="curriculum",
                collection="program_family_facts",
            )
        )
        target_bindings.append(
            _resolve_target_qdrant_binding(
                corpus="curriculum",
                collection="program_semester_facts",
            )
        )
    deduped: list[QdrantIndexBinding] = []
    seen: set[tuple[str, str]] = set()
    for binding in target_bindings:
        key = (binding.alias_name, binding.collection_prefix)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(binding)
    return tuple(deduped)


def _resolve_rebuild_target_qdrant_aliases(
    *,
    source: dict[str, str],
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> tuple[str, ...]:
    return tuple(
        binding.alias_name
        for binding in _resolve_rebuild_target_qdrant_bindings(
            source=source,
            request=request,
            collection_config=collection_config,
        )
    )


def rebuild_local_data(
    *,
    env: dict[str, str] | None = None,
    request: RebuildRequest | None = None,
    collection_config: CollectionTruthConfig | None = None,
    object_store: ReplayObjectStore | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    import_runner: Callable[..., Any] | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> LocalDataRebuildReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or _build_rebuild_request_from_env(source)
    runtime_collection_config = collection_config or resolve_collection_truth_config(
        runtime_request.corpus,
        runtime_request.collection,
    )
    corpus = runtime_request.corpus
    collection = runtime_request.collection
    import_mode = runtime_request.import_mode
    object_store_settings = ObjectStoreSettings.from_env(source)

    object_store_admin = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_document_registry = document_registry or _build_document_registry_for_rebuild(
        source, corpus
    )
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(
        source, corpus
    )
    runtime_request = replace(
        runtime_request,
        source_pdf=_resolve_replay_source_pdf(
            source=source,
            request=runtime_request,
            collection_config=runtime_collection_config,
            raw_asset_registry=runtime_raw_asset_registry,
        ),
    )
    import_env = _build_rebuild_import_env(
        source=source,
        request=runtime_request,
        collection_config=runtime_collection_config,
    )
    trace_recorder = _build_rebuild_trace_recorder(import_env)
    processed_exclude_keys = _processed_bucket_exclude_keys(
        source=import_env,
        corpus=corpus,
        collection=collection,
        import_mode=import_mode,
    )
    processed_object_keys = _run_traced_stage(
        trace_recorder,
        "rebuild.cleanup.collect_processed_keys",
        lambda: _collect_processed_rebuild_keys(
            source=import_env,
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            registry=runtime_document_registry,
        ),
        fields={
            "corpus": corpus,
            "collection": collection,
            "import_mode": import_mode,
        },
        result_fields=lambda object_keys: {"processed_key_count": len(object_keys)},
    )
    _run_traced_stage(
        trace_recorder,
        "rebuild.cleanup.delete_processed_objects",
        lambda: _delete_object_keys(
            object_store_admin=object_store_admin,
            bucket=object_store_settings.bucket_derived,
            object_keys=processed_object_keys,
            exclude_keys=processed_exclude_keys,
        ),
        fields={
            "corpus": corpus,
            "collection": collection,
            "object_key_count": len(processed_object_keys),
            "exclude_key_count": len(processed_exclude_keys),
        },
    )
    if _should_delete_document_registry_scope(collection=collection, import_mode=import_mode):
        _run_traced_stage(
            trace_recorder,
            "rebuild.cleanup.delete_registry_scope",
            lambda: runtime_document_registry.delete_by_scope(corpus, collection),
            fields={
                "corpus": corpus,
                "collection": collection,
            },
        )

    if runtime_request.reset_qdrant:
        retrieval_settings = RetrievalSettings.from_env(source)
        qdrant_collection_admin = qdrant_admin or QdrantCollectionAdmin(
            _build_qdrant_client(retrieval_settings, source=source)
        )
        bindings = _resolve_rebuild_target_qdrant_bindings(
            source=source,
            request=runtime_request,
            collection_config=runtime_collection_config,
        )
        _run_traced_stage(
            trace_recorder,
            "rebuild.reset_qdrant_bindings",
            lambda: tuple(
                qdrant_collection_admin.reset_index_binding(binding) for binding in bindings
            ),
            fields={
                "corpus": corpus,
                "collection": collection,
                "binding_count": len(bindings),
                "aliases": tuple(binding.alias_name for binding in bindings),
            },
        )

    runtime_import_runner = import_runner or _resolve_import_runner(import_mode)
    import_result = _run_traced_stage(
        trace_recorder,
        "rebuild.import_runner",
        lambda: _invoke_import_runner(
            runtime_import_runner=runtime_import_runner,
            source=import_env,
            request=runtime_request,
        ),
        fields={
            "corpus": corpus,
            "collection": collection,
            "import_mode": import_mode,
        },
        result_fields=_summarize_rebuild_import_result,
    )
    return LocalDataRebuildReport(
        import_context=_build_rebuild_report_context(import_env),
        import_result=import_result,
    )


def _build_rebuild_request_from_env(source: dict[str, str]) -> RebuildRequest:
    corpus = _read_required_scope_part(source, "REBUILD_CORPUS")
    collection = _read_required_scope_part(source, "REBUILD_COLLECTION")
    assert_known_scope(corpus, collection)
    import_mode = _read_rebuild_import_mode(source)
    raw_asset_id = _normalize_optional_text(source.get("RAW_ASSET_ID"))
    raw_version_id = _normalize_optional_text(source.get("RAW_VERSION_ID"))
    if import_mode == "provider_response_replay" and raw_version_id is None:
        raise ValueError("RAW_VERSION_ID is required for provider_response_replay")
    return RebuildRequest(
        corpus=corpus,
        collection=collection,
        import_mode=import_mode,
        raw_version_id=raw_version_id,
        raw_asset_id=raw_asset_id,
        source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        reset_qdrant=_parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False),
        index_qdrant=_parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False),
        publish_qdrant_alias=_parse_bool(source.get("REBUILD_PUBLISH_ALIAS"), default=True),
    )


def _build_rebuild_import_env(
    *,
    source: dict[str, str],
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> dict[str, str]:
    import_env = dict(source)
    import_env["REBUILD_CORPUS"] = request.corpus
    import_env["REBUILD_COLLECTION"] = request.collection
    import_env["REBUILD_IMPORT_MODE"] = request.import_mode
    if request.reset_qdrant:
        import_env["REBUILD_RESET_QDRANT"] = "1"
    if request.index_qdrant:
        import_env["REBUILD_INDEX_QDRANT"] = "1"
    if not request.publish_qdrant_alias:
        import_env["REBUILD_PUBLISH_ALIAS"] = "0"
    if request.raw_asset_id:
        import_env["RAW_ASSET_ID"] = request.raw_asset_id
    if request.raw_version_id:
        import_env["RAW_VERSION_ID"] = request.raw_version_id
    if collection_config.split_manifest_path.exists():
        import_env["INGESTION_SPLIT_MANIFEST_PATH"] = str(
            collection_config.split_manifest_path.resolve()
        )
    if collection_config.source_projections_path is not None:
        import_env["HANDBOOK_SOURCE_PROJECTIONS_PATH"] = str(
            collection_config.source_projections_path.resolve()
        )
    import_env["QDRANT_TARGET_ALIASES"] = ",".join(
        _resolve_rebuild_target_qdrant_aliases(
            source=source,
            request=request,
            collection_config=collection_config,
        )
    )
    if request.import_mode == "provider_response_replay":
        raw_version_id = request.raw_version_id
        if raw_version_id is None:
            raise ValueError("raw_version_id is required for provider_response_replay")
        source_pdf = request.source_pdf or _default_replay_source_pdf(request.collection)
        import_env["REPLAY_SOURCE_PDF"] = source_pdf
    return import_env


_REBUILD_REPORT_CONTEXT_KEYS = (
    "REBUILD_CORPUS",
    "REBUILD_COLLECTION",
    "REBUILD_IMPORT_MODE",
    "REBUILD_RESET_QDRANT",
    "REBUILD_INDEX_QDRANT",
    "REBUILD_PUBLISH_ALIAS",
    "RAW_ASSET_ID",
    "RAW_VERSION_ID",
    "INGESTION_SPLIT_MANIFEST_PATH",
    "HANDBOOK_SOURCE_PROJECTIONS_PATH",
    "REPLAY_SOURCE_PDF",
    "QDRANT_TARGET_ALIASES",
)


def _build_rebuild_report_context(import_env: dict[str, str]) -> dict[str, str]:
    return {
        key: import_env[key]
        for key in _REBUILD_REPORT_CONTEXT_KEYS
        if key in import_env and import_env[key] != ""
    }


def _resolve_collection_raw_asset_id(
    *,
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> str:
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=request.corpus,
        expected_collection=request.collection,
    )
    if request.raw_asset_id is not None and request.raw_asset_id != split_manifest.raw_asset_id:
        raise ValueError(
            "request raw_asset_id does not match collection split manifest raw_asset_id"
        )
    return request.raw_asset_id or split_manifest.raw_asset_id


def _resolve_runtime_collection_config(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
) -> CollectionTruthConfig:
    base = resolve_collection_truth_config(corpus, collection)
    split_manifest_override = _normalize_optional_text(source.get("INGESTION_SPLIT_MANIFEST_PATH"))
    source_projections_override = _normalize_optional_text(
        source.get("HANDBOOK_SOURCE_PROJECTIONS_PATH")
    )
    return CollectionTruthConfig(
        corpus=base.corpus,
        collection=base.collection,
        config_root=base.config_root,
        runtime_profile_path=base.runtime_profile_path,
        split_manifest_path=Path(split_manifest_override).resolve()
        if split_manifest_override
        else base.split_manifest_path,
        canonical_profile_path=base.canonical_profile_path,
        chunk_profile_path=base.chunk_profile_path,
        source_projections_path=(
            Path(source_projections_override).resolve()
            if source_projections_override
            else base.source_projections_path
        ),
        notice_family_config_path=base.notice_family_config_path,
    )


def _list_document_records_for_scope(
    registry: DocumentRegistry,
    corpus: str,
    collection: str,
) -> tuple[Any, ...]:
    list_by_scope = getattr(registry, "list_by_scope", None)
    if callable(list_by_scope):
        return tuple(list_by_scope(corpus, collection))
    list_by_corpus = getattr(registry, "list_by_corpus", None)
    if callable(list_by_corpus):
        return tuple(
            record
            for record in list_by_corpus(corpus)
            if getattr(record, "collection", None) == collection
        )
    return ()


def _collect_processed_rebuild_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
    registry: DocumentRegistry,
) -> tuple[str, ...]:
    keys = [
        key
        for key in _list_processed_object_keys_for_scope(registry, corpus, collection)
        if key and _is_derived_artifact_key(key)
    ]
    keys.extend(
        _extra_processed_rebuild_keys(
            source=source,
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            registry=registry,
        )
    )
    return tuple(dict.fromkeys(keys))


def _extra_processed_rebuild_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
    registry: DocumentRegistry,
) -> tuple[str, ...]:
    if import_mode != "provider_response_replay" or collection != "student_handbook":
        return ()
    return _declared_projection_processed_keys(
        source=source,
        registry=registry,
    )


def _is_derived_artifact_key(key: str) -> bool:
    return not is_source_object_key(key)


def _build_qdrant_client(
    settings: RetrievalSettings, *, source: dict[str, str] | None = None
) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=_resolve_ingestion_qdrant_timeout_seconds(
            source=source,
            default_timeout_seconds=settings.qdrant_timeout_seconds,
        ),
        cloud_inference=True,
        check_compatibility=False,
        trust_env=False,
    )


def _resolve_ingestion_qdrant_timeout_seconds(
    *,
    source: dict[str, str] | None,
    default_timeout_seconds: float,
) -> float:
    env = source if source is not None else {}
    raw_value = _normalize_optional_text(env.get("INGESTION_QDRANT_TIMEOUT_SECONDS"))
    if raw_value is not None:
        timeout_seconds = float(raw_value)
        if timeout_seconds <= 0:
            raise ValueError("INGESTION_QDRANT_TIMEOUT_SECONDS must be greater than zero")
        return timeout_seconds
    return max(default_timeout_seconds, DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS)


def _read_rebuild_import_mode(source: dict[str, str]) -> str:
    import_mode = (source.get("REBUILD_IMPORT_MODE") or "").strip()
    if not import_mode:
        raise ValueError("REBUILD_IMPORT_MODE is required")
    if import_mode not in ALLOWED_REBUILD_IMPORT_MODES:
        raise ValueError(f"unsupported REBUILD_IMPORT_MODE: {import_mode}")
    return import_mode


def _invoke_import_runner(
    *,
    runtime_import_runner: Callable[..., Any],
    source: dict[str, str],
    request: RebuildRequest,
) -> Any:
    from campus_ingestion_core.local_rebuild_replay import replay_provider_response_rebuild

    if runtime_import_runner is process_raw_ingestion_job:
        return runtime_import_runner(
            env=source,
            request=_build_raw_ingestion_request(source=source, request=request),
        )
    if runtime_import_runner is replay_provider_response_rebuild:
        return runtime_import_runner(
            env=source,
            request=request,
        )
    return runtime_import_runner(env=source, request=request)


def _build_raw_ingestion_request(
    *,
    source: dict[str, str],
    request: RebuildRequest,
) -> RawIngestionRequest:
    return RawIngestionRequest(
        raw_asset_id=_read_required_env(source, "RAW_ASSET_ID"),
        raw_version_id=_read_required_env(source, "RAW_VERSION_ID"),
        corpus=request.corpus,
        collection=request.collection,
        artifact_mode=(source.get("RAW_INGESTION_ARTIFACT_MODE") or "normalized").strip()
        or "normalized",
        split_manifest_path=(
            Path(source["INGESTION_SPLIT_MANIFEST_PATH"]).resolve()
            if (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
            else None
        ),
        report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
        default_visibility_scope=_read_default_visibility_scope(source),
    )


def _build_replay_request_from_env(source: dict[str, str]) -> RebuildRequest:
    corpus = _read_required_scope_part(source, "REBUILD_CORPUS")
    collection = _read_required_scope_part(source, "REBUILD_COLLECTION")
    assert_known_scope(corpus, collection)
    raw_version_id = _normalize_optional_text(source.get("RAW_VERSION_ID"))
    if raw_version_id is None:
        raise ValueError("RAW_VERSION_ID is required for provider_response_replay")
    return RebuildRequest(
        corpus=corpus,
        collection=collection,
        import_mode="provider_response_replay",
        raw_version_id=raw_version_id,
        raw_asset_id=_normalize_optional_text(source.get("RAW_ASSET_ID")),
        source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        reset_qdrant=_parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False),
        index_qdrant=_parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False),
        publish_qdrant_alias=_parse_bool(source.get("REBUILD_PUBLISH_ALIAS"), default=True),
    )


def _resolve_import_runner(import_mode: str) -> Callable[..., Any]:
    from campus_ingestion_core.local_rebuild_replay import replay_provider_response_rebuild

    if import_mode == "raw_online_ocr":
        return process_raw_ingestion_job
    if import_mode == "provider_response_replay":
        return replay_provider_response_rebuild
    raise ValueError(f"unsupported REBUILD_IMPORT_MODE: {import_mode}")


def _build_document_registry_for_rebuild(source: dict[str, str], corpus: str) -> DocumentRegistry:
    try:
        return build_document_registry_from_env(source)
    except ValueError as exc:
        if str(exc) == "DOCUMENT_REGISTRY_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL is required":
            raise ValueError(str(exc)) from exc
        raise


def _build_raw_asset_registry_for_rebuild(source: dict[str, str], corpus: str) -> RawAssetRegistry:
    return build_raw_asset_registry_from_env(source)


def _processed_bucket_exclude_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
) -> tuple[str, ...]:
    if import_mode != "provider_response_replay" or collection != "student_handbook":
        return ()
    raw_version_id = _read_required_env(source, "RAW_VERSION_ID")
    collection_config = _resolve_runtime_collection_config(
        source=source, corpus=corpus, collection=collection
    )
    raw_asset_id = _resolve_collection_raw_asset_id(
        request=RebuildRequest(
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            raw_version_id=raw_version_id,
            raw_asset_id=_normalize_optional_text(source.get("RAW_ASSET_ID")),
            source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        ),
        collection_config=collection_config,
    )
    source_pdf = (
        source.get("REPLAY_SOURCE_PDF") or DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF
    ).strip() or DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF
    provider_response_key = build_source_ocr_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        source_channel=DEFAULT_RAW_SOURCE_CHANNEL,
        model_slug=build_source_model_slug(
            (source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip()
            or DEFAULT_ONLINE_OCR_MODEL
        ),
        year=infer_year_label(source_pdf),
    )
    return (provider_response_key,)


def _should_delete_document_registry_scope(*, collection: str, import_mode: str) -> bool:
    return not (collection == "student_handbook" and import_mode == "provider_response_replay")


def _should_index_qdrant_for_replay(source: dict[str, str]) -> bool:
    return _parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False)


def _should_publish_qdrant_alias_for_replay(source: dict[str, str]) -> bool:
    return _parse_bool(source.get("REBUILD_PUBLISH_ALIAS"), default=True)


def _resolve_replay_source_pdf(
    *,
    source: dict[str, str],
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
    raw_asset_registry: RawAssetRegistry,
) -> str | None:
    if request.import_mode != "provider_response_replay":
        return request.source_pdf
    if request.source_pdf is not None:
        return request.source_pdf
    raw_version_id = request.raw_version_id
    if raw_version_id is None:
        return _default_replay_source_pdf(request.collection)
    raw_asset_id = _resolve_collection_raw_asset_id(
        request=request, collection_config=collection_config
    )
    raw_asset_record = raw_asset_registry.get(raw_asset_id, raw_version_id)
    if raw_asset_record is not None and raw_asset_record.source_filename.strip():
        return raw_asset_record.source_filename.strip()
    return _default_replay_source_pdf(request.collection)


def _default_replay_source_pdf(collection: str) -> str:
    if collection == "curriculum_plan":
        return DEFAULT_CURRICULUM_PLAN_REPLAY_SOURCE_PDF
    return DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF


def _declared_projection_processed_keys(
    *,
    source: dict[str, str],
    registry: DocumentRegistry,
) -> tuple[str, ...]:
    path_value = (source.get("HANDBOOK_SOURCE_PROJECTIONS_PATH") or "").strip()
    if not path_value:
        return ()
    config = load_handbook_source_projections_config(Path(path_value))
    source_pdf = (
        source.get("REPLAY_SOURCE_PDF") or DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF
    ).strip() or DEFAULT_STUDENT_HANDBOOK_REPLAY_SOURCE_PDF
    keys = list(
        build_declared_projection_processed_keys(
            config=config,
            source_pdf=source_pdf,
        )
    )
    for projection in config.projections:
        scope = (projection.target_corpus, projection.target_collection)
        if scope == (config.source_corpus, config.source_collection):
            continue
        keys.extend(_list_processed_object_keys_for_scope(registry, scope[0], scope[1]))
    return tuple(dict.fromkeys(keys))


def _list_processed_object_keys_for_scope(
    registry: DocumentRegistry,
    corpus: str,
    collection: str,
) -> tuple[str, ...]:
    list_scope_keys = getattr(registry, "list_processed_object_keys_by_scope", None)
    if callable(list_scope_keys):
        return tuple(str(key) for key in list_scope_keys(corpus, collection) if key)

    keys: list[str] = []
    for record in _list_document_records_for_scope(registry, corpus, collection):
        keys.extend(
            str(key) for key in tuple(getattr(record, "processed_object_keys", ()) or ()) if key
        )
    return tuple(dict.fromkeys(keys))
