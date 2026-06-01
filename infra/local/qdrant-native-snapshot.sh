#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  qdrant-native-snapshot.sh create-collection \
    --collection <physical_collection> \
    --alias <serving_alias> \
    --corpus <corpus> \
    --logical-collection <collection> \
    --release-id <release_id> \
    --manifest-key <index_release_manifest_key> \
    --output-root <path> \
    --operator <operator>

  qdrant-native-snapshot.sh restore-collection \
    --collection <target_physical_collection> \
    --snapshot <snapshot_path> \
    --manifest <backup_manifest_path> \
    [--apply-alias]

  qdrant-native-snapshot.sh list-collection --collection <physical_collection>

Environment:
  QDRANT_URL      Required Qdrant HTTP endpoint.
  QDRANT_API_KEY  Required Qdrant API key.
USAGE
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  if [[ -z "${!1:-}" ]]; then
    echo "$1 is required" >&2
    exit 1
  fi
}

json_escape() {
  jq -Rn --arg value "$1" '$value'
}

qdrant_url() {
  printf '%s' "${QDRANT_URL%/}"
}

qdrant_get() {
  curl --fail-with-body --silent --show-error \
    -H "api-key: ${QDRANT_API_KEY}" \
    "$@"
}

qdrant_post() {
  curl --fail-with-body --silent --show-error \
    -X POST \
    -H "api-key: ${QDRANT_API_KEY}" \
    "$@"
}

qdrant_delete() {
  curl --fail-with-body --silent --show-error \
    -X DELETE \
    -H "api-key: ${QDRANT_API_KEY}" \
    "$@"
}

parse_args() {
  collection=""
  alias=""
  corpus=""
  logical_collection=""
  release_id=""
  manifest_key=""
  output_root=""
  operator=""
  snapshot_path=""
  backup_manifest_path=""
  apply_alias="false"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --collection) collection="$2"; shift 2 ;;
      --alias) alias="$2"; shift 2 ;;
      --corpus) corpus="$2"; shift 2 ;;
      --logical-collection) logical_collection="$2"; shift 2 ;;
      --release-id) release_id="$2"; shift 2 ;;
      --manifest-key) manifest_key="$2"; shift 2 ;;
      --output-root) output_root="$2"; shift 2 ;;
      --operator) operator="$2"; shift 2 ;;
      --snapshot) snapshot_path="$2"; shift 2 ;;
      --manifest) backup_manifest_path="$2"; shift 2 ;;
      --apply-alias) apply_alias="true"; shift ;;
      *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
    esac
  done
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    echo "${name} is required" >&2
    exit 1
  fi
}

collection_points_count() {
  qdrant_get "$(qdrant_url)/collections/${collection}" | jq -e '.result.points_count'
}

collection_release_payload() {
  qdrant_post \
    -H "Content-Type: application/json" \
    --data '{"limit":1,"with_payload":true,"with_vector":false}' \
    "$(qdrant_url)/collections/${collection}/points/scroll" |
    jq -e '.result.points[0].payload'
}

validate_collection_payload() {
  local expected_release_id="$1"
  local expected_manifest_key="$2"
  local expected_alias="$3"
  local payload actual_release_id actual_manifest_key actual_alias
  payload="$(collection_release_payload)"
  actual_release_id="$(jq -er '.index_release_id' <<<"${payload}")"
  actual_manifest_key="$(jq -er '.index_release_manifest_key' <<<"${payload}")"
  actual_alias="$(jq -er '.index_release_alias' <<<"${payload}")"

  if [[ "${actual_release_id}" != "${expected_release_id}" ]]; then
    echo "payload release id mismatch: ${actual_release_id}" >&2
    exit 1
  fi
  if [[ "${actual_manifest_key}" != "${expected_manifest_key}" ]]; then
    echo "payload manifest key mismatch: ${actual_manifest_key}" >&2
    exit 1
  fi
  if [[ "${actual_alias}" != "${expected_alias}" ]]; then
    echo "payload alias mismatch: ${actual_alias}" >&2
    exit 1
  fi
}

create_collection_snapshot() {
  parse_args "$@"
  require_value "--collection" "${collection:-}"
  require_value "--alias" "${alias:-}"
  require_value "--corpus" "${corpus:-}"
  require_value "--logical-collection" "${logical_collection:-}"
  require_value "--release-id" "${release_id:-}"
  require_value "--manifest-key" "${manifest_key:-}"
  require_value "--output-root" "${output_root:-}"
  require_value "--operator" "${operator:-}"

  local point_count
  point_count="$(collection_points_count)"
  validate_collection_payload "${release_id}" "${manifest_key}" "${alias}"

  local backup_id snapshot_name bundle_dir snapshot_path snapshot_sha
  backup_id="$(date -u +b%Y%m%dT%H%M%SZ)"
  bundle_dir="${output_root%/}/${corpus}/${logical_collection}/${release_id}/${backup_id}"
  mkdir -p "${bundle_dir}"

  snapshot_name="$(
    qdrant_post "$(qdrant_url)/collections/${collection}/snapshots?wait=true" |
      jq -er '.result.name'
  )"
  snapshot_path="${bundle_dir}/${snapshot_name}"
  qdrant_get "$(qdrant_url)/collections/${collection}/snapshots/${snapshot_name}" \
    --output "${snapshot_path}"
  snapshot_sha="$(sha256sum "${snapshot_path}" | awk '{print $1}')"

  cat >"${bundle_dir}/backup-manifest.json" <<JSON
{
  "schema_version": "qdrant_native_collection_snapshot_backup.v1",
  "backup_id": $(json_escape "${backup_id}"),
  "backup_mode": "qdrant_native_collection_snapshot",
  "captured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "corpus": $(json_escape "${corpus}"),
  "collection": $(json_escape "${logical_collection}"),
  "release_id": $(json_escape "${release_id}"),
  "serving_alias": $(json_escape "${alias}"),
  "physical_collection_name": $(json_escape "${collection}"),
  "alias_bindings": {
    $(json_escape "${alias}"): $(json_escape "${collection}")
  },
  "index_release_manifest_key": $(json_escape "${manifest_key}"),
  "snapshot_file": $(json_escape "${snapshot_name}"),
  "snapshot_sha256": $(json_escape "${snapshot_sha}"),
  "snapshot_size_bytes": $(stat -c '%s' "${snapshot_path}"),
  "point_count": ${point_count},
  "operator": $(json_escape "${operator}")
}
JSON
  printf '%s  %s\n' "${snapshot_sha}" "${snapshot_name}" >"${bundle_dir}/sha256.txt"
  cat >"${bundle_dir}/restore-command.txt" <<RESTORE
cd ${bundle_dir}
QDRANT_URL=<target-url> QDRANT_API_KEY=<target-key> /srv/apps/campus-agent/infra/local/qdrant-native-snapshot.sh restore-collection --collection ${collection} --snapshot ${snapshot_name} --manifest backup-manifest.json --apply-alias
RESTORE
  qdrant_delete "$(qdrant_url)/collections/${collection}/snapshots/${snapshot_name}?wait=true" >/dev/null
  jq -S . "${bundle_dir}/backup-manifest.json"
}

restore_collection_snapshot() {
  parse_args "$@"
  require_value "--collection" "${collection:-}"
  require_value "--snapshot" "${snapshot_path:-}"
  require_value "--manifest" "${backup_manifest_path:-}"

  if [[ ! -f "${snapshot_path}" ]]; then
    echo "snapshot file does not exist: ${snapshot_path}" >&2
    exit 1
  fi
  if [[ ! -f "${backup_manifest_path}" ]]; then
    echo "backup manifest does not exist: ${backup_manifest_path}" >&2
    exit 1
  fi

  local checksum manifest_collection manifest_snapshot manifest_checksum manifest_release_id
  local manifest_key manifest_alias manifest_point_count restored_point_count alias_operations
  checksum="$(sha256sum "${snapshot_path}" | awk '{print $1}')"
  manifest_checksum="$(jq -er '.snapshot_sha256' "${backup_manifest_path}")"
  if [[ "${checksum}" != "${manifest_checksum}" ]]; then
    echo "snapshot sha256 does not match backup-manifest.json" >&2
    exit 1
  fi
  if [[ -f "$(dirname "${backup_manifest_path}")/sha256.txt" ]] &&
    ! grep -q "^${checksum}  " "$(dirname "${backup_manifest_path}")/sha256.txt"; then
    echo "snapshot sha256 does not match sha256.txt" >&2
    exit 1
  fi
  manifest_collection="$(jq -er '.physical_collection_name' "${backup_manifest_path}")"
  manifest_snapshot="$(jq -er '.snapshot_file' "${backup_manifest_path}")"
  if [[ "$(basename "${snapshot_path}")" != "${manifest_snapshot}" ]]; then
    echo "manifest snapshot file mismatch: ${manifest_snapshot}" >&2
    exit 1
  fi
  manifest_release_id="$(jq -er '.release_id' "${backup_manifest_path}")"
  manifest_key="$(jq -er '.index_release_manifest_key' "${backup_manifest_path}")"
  manifest_alias="$(jq -er '.serving_alias' "${backup_manifest_path}")"
  manifest_point_count="$(jq -er '.point_count' "${backup_manifest_path}")"
  qdrant_post \
    -F "snapshot=@${snapshot_path}" \
    "$(qdrant_url)/collections/${collection}/snapshots/upload?wait=true&priority=snapshot&checksum=${checksum}"
  restored_point_count="$(collection_points_count)"
  if [[ "${restored_point_count}" != "${manifest_point_count}" ]]; then
    echo "restored point count mismatch: ${restored_point_count}" >&2
    exit 1
  fi
  validate_collection_payload "${manifest_release_id}" "${manifest_key}" "${manifest_alias}"

  if [[ "${apply_alias}" == "true" ]]; then
    alias_operations="$(
      jq -cn \
        --argjson bindings "$(jq -c '.alias_bindings' "${backup_manifest_path}")" \
        --argjson existing "$(qdrant_get "$(qdrant_url)/aliases" | jq -c '.result.aliases // []')" \
        --arg original_collection "${manifest_collection}" \
        --arg target_collection "${collection}" \
        '
          def alias_target($name):
            first($existing[]? | select(.alias_name == $name) | .collection_name) // null;
          def target_collection($name):
            if $name == $original_collection then $target_collection else $name end;
          [
            $bindings | to_entries[] | . as $binding |
            (alias_target($binding.key)) as $current |
            (target_collection($binding.value)) as $target |
            if $current == $target then
              empty
            elif $current == null then
              {"create_alias": {"collection_name": $target, "alias_name": $binding.key}}
            else
              {"delete_alias": {"alias_name": $binding.key}},
              {"create_alias": {"collection_name": $target, "alias_name": $binding.key}}
            end
          ]
        '
    )"
    if jq -e 'length > 0' <<<"${alias_operations}" >/dev/null; then
      qdrant_post \
        -H "Content-Type: application/json" \
        --data "{\"actions\":${alias_operations}}" \
        "$(qdrant_url)/collections/aliases" >/dev/null
    fi
  fi
  jq -S --arg restored_collection "${collection}" \
    '{source_collection: .physical_collection_name, restored_collection: $restored_collection, alias_bindings}' \
    "${backup_manifest_path}"
}

list_collection_snapshots() {
  parse_args "$@"
  require_value "--collection" "${collection:-}"
  qdrant_get "$(qdrant_url)/collections/${collection}/snapshots" | jq -S .
}

main() {
  require_command curl
  require_command jq
  require_command sha256sum
  require_env QDRANT_URL
  require_env QDRANT_API_KEY

  local command="${1:-}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "${command}" in
    create-collection) create_collection_snapshot "$@" ;;
    restore-collection) restore_collection_snapshot "$@" ;;
    list-collection) list_collection_snapshots "$@" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
