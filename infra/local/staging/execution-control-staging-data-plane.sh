#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

execution_control_staging_ensure_data_plane_network() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"
  if ! "${docker_bin}" network inspect "${execution_control_staging_data_plane_network}" >/dev/null 2>&1; then
    "${docker_bin}" network create "${execution_control_staging_data_plane_network}" >/dev/null
  fi
}

execution_control_staging_requires_local_postgres_dependency() {
  [[ "${EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_POSTGRES:-false}" == "true" ]]
}

execution_control_staging_requires_local_minio_dependency() {
  [[ "${EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_MINIO:-false}" == "true" ]]
}

execution_control_staging_requires_local_qdrant_dependency() {
  [[ "${EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_QDRANT:-false}" == "true" ]]
}

execution_control_staging_dependency_compose() {
  local project_name="$1"
  local compose_file="$2"
  shift 2
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    "${docker_bin}" compose -f "${compose_file}" "$@"
  )
}

execution_control_staging_postgres_compose() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${execution_control_staging_postgres_compose_project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    LOCAL_POSTGRES_DB="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB is required}" \
    LOCAL_POSTGRES_USER="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER is required}" \
    LOCAL_POSTGRES_PASSWORD="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PASSWORD:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PASSWORD is required}" \
    LOCAL_POSTGRES_PORT="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT is required}" \
    "${docker_bin}" compose -f "${execution_control_staging_postgres_compose_file}" "$@"
  )
}

execution_control_staging_minio_compose() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${execution_control_staging_minio_compose_project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    OBJECT_STORE_ACCESS_KEY="${EXECUTION_CONTROL_STAGING_LOCAL_MINIO_ACCESS_KEY:?EXECUTION_CONTROL_STAGING_LOCAL_MINIO_ACCESS_KEY is required}" \
    OBJECT_STORE_SECRET_KEY="${EXECUTION_CONTROL_STAGING_LOCAL_MINIO_SECRET_KEY:?EXECUTION_CONTROL_STAGING_LOCAL_MINIO_SECRET_KEY is required}" \
    "${docker_bin}" compose -f "${execution_control_staging_minio_compose_file}" "$@"
  )
}

execution_control_staging_qdrant_compose() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${execution_control_staging_qdrant_compose_project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    QDRANT_API_KEY="${QDRANT_API_KEY:?QDRANT_API_KEY is required}" \
    QDRANT_READ_ONLY_API_KEY="${QDRANT_READ_ONLY_API_KEY:?QDRANT_READ_ONLY_API_KEY is required}" \
    "${docker_bin}" compose -f "${execution_control_staging_qdrant_compose_file}" "$@"
  )
}

execution_control_staging_ensure_local_minio_volume() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"
  "${docker_bin}" volume create local_minio-data >/dev/null
}

execution_control_staging_ensure_local_minio_bucket() {
  execution_control_staging_wait_for_http_ok "http://127.0.0.1:9000/minio/health/ready" 45 2
  execution_control_staging_uv_run --all-packages python - <<'PY'
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings

settings = ObjectStoreSettings.from_env()
S3ObjectStoreAdmin(settings).ensure_bucket(bucket=settings.bucket_derived)
PY
}

execution_control_staging_ensure_self_hosted_data_plane_dependencies() {
  execution_control_staging_ensure_data_plane_network
  if execution_control_staging_requires_local_postgres_dependency; then
    execution_control_staging_postgres_compose up -d
  fi
  if execution_control_staging_requires_local_minio_dependency; then
    execution_control_staging_ensure_local_minio_volume
    execution_control_staging_minio_compose up -d
    execution_control_staging_ensure_local_minio_bucket
  fi
  if execution_control_staging_requires_local_qdrant_dependency; then
    execution_control_staging_qdrant_compose up -d
  fi
}

execution_control_staging_require_container_qdrant_ready() {
  local docker_bin
  local qdrant_ready_status
  local qdrant_collections_status
  local qdrant_bm25_canary_status
  docker_bin="$(execution_control_staging_require_command docker)"

  qdrant_ready_status="$(
    "${docker_bin}" compose \
      -p "${execution_control_staging_compose_project_name}" \
      -f "${execution_control_staging_compose_file}" \
      exec -T supervisor-agent-worker python -c \
'import os,sys,urllib.request; base=os.environ["QDRANT_URL"].rstrip("/"); req=urllib.request.Request(base+"/readyz", headers={"api-key": os.environ.get("QDRANT_API_KEY", "")}); r=urllib.request.urlopen(req, timeout=5); sys.stdout.write(str(r.status))'
  )"
  if [[ "${qdrant_ready_status}" != "200" ]]; then
    echo "supervisor-agent-worker cannot reach Qdrant /readyz via container data-plane URL; status=${qdrant_ready_status}" >&2
    return 1
  fi

  qdrant_collections_status="$(
    "${docker_bin}" compose \
      -p "${execution_control_staging_compose_project_name}" \
      -f "${execution_control_staging_compose_file}" \
      exec -T supervisor-agent-worker python -c \
'import os,sys,urllib.request; base=os.environ["QDRANT_URL"].rstrip("/"); req=urllib.request.Request(base+"/collections", headers={"api-key": os.environ.get("QDRANT_API_KEY", "")}); r=urllib.request.urlopen(req, timeout=5); sys.stdout.write(str(r.status))'
  )"
  if [[ "${qdrant_collections_status}" != "200" ]]; then
    echo "supervisor-agent-worker cannot reach Qdrant /collections via container data-plane URL; status=${qdrant_collections_status}" >&2
    return 1
  fi

  if ! qdrant_bm25_canary_status="$(
    "${docker_bin}" compose \
      -p "${execution_control_staging_compose_project_name}" \
      -f "${execution_control_staging_compose_file}" \
      exec -T supervisor-agent-worker python - <<'PY'
import os
import sys
import time
import uuid

from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

collection = f"bm25_canary_{int(time.time())}_{uuid.uuid4().hex[:8]}"
client = QdrantClient(
    url=os.environ["QDRANT_URL"],
    api_key=os.environ.get("QDRANT_API_KEY") or None,
    timeout=30,
    cloud_inference=False,
    check_compatibility=False,
    trust_env=False,
)
bm25_document = qdrant_models.Document(
    text="server side bm25 canary",
    model="qdrant/bm25",
    options=qdrant_models.Bm25Config(
        tokenizer=qdrant_models.TokenizerType.MULTILINGUAL,
        language="none",
        lowercase=True,
        ascii_folding=False,
    ),
)
collection_created = False
try:
    client.create_collection(
        collection_name=collection,
        vectors_config={"dense": qdrant_models.VectorParams(size=4, distance=qdrant_models.Distance.COSINE)},
        sparse_vectors_config={"sparse": qdrant_models.SparseVectorParams(modifier=qdrant_models.Modifier.IDF)},
    )
    collection_created = True
    client.upsert(
        collection_name=collection,
        points=[
            qdrant_models.PointStruct(
                id=1,
                vector={"dense": [0.1, 0.2, 0.3, 0.4], "sparse": bm25_document},
                payload={"kind": "bm25_canary"},
            )
        ],
        wait=True,
    )
    result = client.query_points(
        collection_name=collection,
        query=bm25_document,
        using="sparse",
        limit=1,
        with_payload=True,
    )
    if not result.points:
        raise RuntimeError("empty BM25 canary query result")
    if result.points[0].payload.get("kind") != "bm25_canary":
        raise RuntimeError(f"unexpected BM25 canary payload: {result.points[0].payload!r}")
    sys.stdout.write("ok")
finally:
    if collection_created:
        client.delete_collection(collection_name=collection)
PY
  )"; then
    echo "Qdrant server-side BM25 inference is not available via container data-plane URL." >&2
    if [[ -n "${qdrant_bm25_canary_status:-}" ]]; then
      echo "${qdrant_bm25_canary_status}" >&2
    fi
    return 1
  fi
  if [[ "${qdrant_bm25_canary_status}" != "ok" ]]; then
    echo "Qdrant server-side BM25 inference is not available via container data-plane URL; status=${qdrant_bm25_canary_status}" >&2
    return 1
  fi
}

execution_control_staging_require_data_plane_ready() {
  execution_control_staging_require_registry_collection_rename_closed
  execution_control_staging_require_rag_runtime_ready
}

execution_control_staging_require_registry_collection_rename_closed() {
  local node_bin
  local audit_json
  local legacy_summary

  node_bin="$(execution_control_staging_require_command node)"
  if ! audit_json="$(
    execution_control_staging_uv_run --all-packages python -m \
      campus_ingestion_worker.collection_rename_registry_backfill audit
  )"; then
    echo "execution-control staging registry collection rename audit failed." >&2
    return 1
  fi

  if ! legacy_summary="$(
    REGISTRY_COLLECTION_RENAME_AUDIT_JSON="${audit_json}" "${node_bin}" <<'NODE'
const payload = JSON.parse(process.env.REGISTRY_COLLECTION_RENAME_AUDIT_JSON || "{}");
const targets = Array.isArray(payload.targets) ? payload.targets : [];
const legacyLines = [];

for (const target of targets) {
  const count = Number(target.legacy_row_count || 0);
  if (count <= 0) {
    continue;
  }
  const targetNames = Array.isArray(target.target_names) ? target.target_names.join(",") : "";
  const samples = Array.isArray(target.sample_rows)
    ? target.sample_rows
        .map((sample) => {
          const identity = String(sample.identity || "");
          const column = String(sample.column_collection || "");
          const record = sample.record_collection == null ? "" : String(sample.record_collection);
          return `${identity} column=${column} record=${record}`;
        })
        .filter(Boolean)
        .join("; ")
    : "";
  legacyLines.push(
    `${target.kind || "unknown"} ${target.table_name || "unknown"} (${targetNames}): ${count} legacy rows remain${samples ? `; samples: ${samples}` : ""}`,
  );
}

if (legacyLines.length > 0) {
  console.log(legacyLines.join("\n"));
}
NODE
  )"; then
    echo "execution-control staging registry collection rename audit returned invalid JSON." >&2
    return 1
  fi

  if [[ -n "${legacy_summary}" ]]; then
    echo "execution-control staging registry collection rename is incomplete:" >&2
    echo "  - legacy collection names remain in ingestion registry; run collection_rename_registry_backfill apply before starting staging runtime." >&2
    echo "  - required renames: student_handbook -> student_rules; institutional_regulations -> institutional_rules" >&2
    while IFS= read -r legacy_line; do
      if [[ -n "${legacy_line}" ]]; then
        echo "  - ${legacy_line}" >&2
      fi
    done <<<"${legacy_summary}"
    return 1
  fi
}

execution_control_staging_require_rag_runtime_ready() {
  local node_bin
  local readiness_json
  local readiness_summary

  node_bin="$(execution_control_staging_require_command node)"
  if ! readiness_json="$(
    execution_control_staging_uv_run --all-packages python -m \
      campus_ingestion_worker.probe_regulation_rag_release_runtime \
      --scope regulations/student_rules \
      --scope regulations/institutional_rules \
      --scope curriculum/curriculum_plan
  )"; then
    echo "execution-control staging RAG runtime readiness probe failed." >&2
    return 1
  fi

  if ! readiness_summary="$(
    RAG_RUNTIME_READINESS_JSON="${readiness_json}" "${node_bin}" <<'NODE'
const payload = JSON.parse(process.env.RAG_RUNTIME_READINESS_JSON || "{}");
const failures = [];
if (payload.qdrant_ready !== "ready") {
  const checks = payload.qdrant_checks && typeof payload.qdrant_checks === "object"
    ? Object.entries(payload.qdrant_checks).map(([path, check]) => {
        const status = check && typeof check === "object" ? check.status : "";
        const body = check && typeof check === "object" ? String(check.body_prefix || "") : "";
        return `${path} status=${status}${body ? ` body=${body.slice(0, 80)}` : ""}`;
      }).join("; ")
    : "";
  failures.push(`qdrant_ready=${payload.qdrant_ready || "<missing>"}${checks ? `; ${checks}` : ""}`);
}
const surfaces = Array.isArray(payload.surfaces) ? payload.surfaces : [];
for (const surface of surfaces) {
  if (!surface || typeof surface !== "object") {
    continue;
  }
  if (surface.readiness_status === "ready") {
    continue;
  }
  const scope = String(surface.scope || "<unknown-scope>");
  const blocker = String(surface.readiness_blocker || "<missing-blocker>");
  const alias = String(surface.alias_name || "");
  const aliasTarget = String(surface.alias_target || "");
  const releaseStatus = String(surface.release_freshness_status || "");
  const latestRelease = String(surface.release_family_latest_physical_collection_name || "");
  const guardStatus = String(surface.release_metadata_guard_status || "");
  const guardMessage = String(surface.release_metadata_guard_message || "");
  const aliasGuardStatus = String(surface.alias_target_guard_status || "");
  const aliasGuardMessage = String(surface.alias_target_guard_message || "");
  failures.push(
    `${scope}: ${blocker}; alias=${alias}${aliasTarget ? `->${aliasTarget}` : ""}; latest=${latestRelease}; release=${releaseStatus}; guard=${guardStatus}${guardMessage ? ` ${guardMessage}` : ""}; alias_guard=${aliasGuardStatus}${aliasGuardMessage ? ` ${aliasGuardMessage}` : ""}`,
  );
}
if (failures.length > 0) {
  console.log(failures.join("\n"));
}
NODE
  )"; then
    echo "execution-control staging RAG runtime readiness probe returned invalid JSON." >&2
    return 1
  fi

  if [[ -n "${readiness_summary}" ]]; then
    echo "execution-control staging RAG runtime is not ready:" >&2
    while IFS= read -r readiness_line; do
      if [[ -n "${readiness_line}" ]]; then
        echo "  - ${readiness_line}" >&2
      fi
    done <<<"${readiness_summary}"
    return 1
  fi
}
