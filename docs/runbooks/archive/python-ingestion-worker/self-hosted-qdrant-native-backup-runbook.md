---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: historical
created: 2026-06-01
updated: 2026-06-01
---
# Self-Hosted Qdrant Native Backup Runbook

## Scope

This runbook is the active Qdrant deployment and backup path for staging and
early production.

It covers:

- single-node self-hosted Qdrant on `nc-arm-6c`
- Qdrant native collection snapshots
- restore and alias rebind
- retention and off-host archive

It does not cover the historical Qdrant Cloud / Free tier object-store backup
path. That path is retained only in
`docs/runbooks/archive/qdrant-cloud-backup-and-restore-runbook.md`.

## Runtime Contract

Early production and staging use one self-hosted Qdrant node.

Required host layout:

- app root: `/srv/apps/campus-agent`
- Qdrant storage: `/srv/lib/campus-agent/qdrant/storage`
- native snapshot archive:
  `/srv/backups/campus-agent/qdrant-snapshots/native`
- restore/archive bundles:
  `/srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/`
- container image: `qdrant/qdrant:v1.15.5` or newer. `v1.14.x` is not accepted
  for staging / early production because server-side `qdrant/bm25` inference is
  part of the serving contract.

Network contract:

- bind REST and gRPC to `127.0.0.1` or a private interface
- do not expose `6333` or `6334` directly to the public internet
- use API key authentication
- same-host Docker data-plane traffic uses native HTTPS + API key; staging /
  production do not accept `api_key + http://` for Qdrant query runtime
- TLS files are ops-owned runtime material under
  `/srv/docker/campus-agent/staging/qdrant/tls/` and are not committed to the repo
- query runtime receives a read-only Qdrant key through deployment secrets only
- ingestion, snapshot backup, and restore operations use the admin Qdrant key

Sparse contract:

- self-hosted Qdrant executes server-side BM25 inference for `qdrant/bm25`
- Python ingestion/retrieval runtime sends `Document(text, model="qdrant/bm25",
  options=Bm25Config(tokenizer="multilingual", language="none"))`
- do not use Qdrant Cloud inference or a standalone BM25 service for staging /
  early production
- do not use local FastEmbed as the production sparse encoder

`campus-rag-derived-staging` and production serving seed buckets do not store
Qdrant `.snapshot` files.

## Compose Deployment

Create the host directories:

```bash
sudo mkdir -p /srv/lib/campus-agent/qdrant/storage
sudo mkdir -p /srv/backups/campus-agent/qdrant-snapshots/native
sudo chown -R deploy:deploy /srv/lib/campus-agent/qdrant
sudo chown -R deploy:deploy /srv/backups/campus-agent/qdrant-snapshots
```

Prepare an ignored env file on the server, for example
`/srv/apps/campus-agent/.env.qdrant.local`:

```bash
QDRANT_API_KEY=<admin-api-key>
QDRANT_READ_ONLY_API_KEY=<read-only-api-key>
QDRANT_HOST=127.0.0.1
QDRANT_HTTP_PORT=6333
QDRANT_GRPC_PORT=6334
QDRANT_STORAGE_DIR=/srv/lib/campus-agent/qdrant/storage
QDRANT_SNAPSHOTS_DIR=/srv/backups/campus-agent/qdrant-snapshots/native
QDRANT_TLS_DIR=/srv/docker/campus-agent/staging/qdrant/tls
```

The TLS directory must contain:

```text
ca.pem
server.crt
server.key
```

The server certificate SAN must include `qdrant`, `localhost`, and `127.0.0.1`.

Start Qdrant. Create the shared Docker data-plane network first. Qdrant keeps
host-side ports bound to loopback, while supervisor containers reach it through
Docker service DNS `https://qdrant:6333` on `campus-agent-data-plane`:

```bash
cd /srv/apps/campus-agent
docker network inspect campus-agent-data-plane >/dev/null 2>&1 || \
  docker network create campus-agent-data-plane >/dev/null
docker compose --env-file .env.qdrant.local \
  -f infra/local/docker-compose.qdrant-single-node.yml up -d
```

Health checks:

```bash
curl --cacert "$QDRANT_TLS_DIR/ca.pem" -fsS \
  -H "api-key: $QDRANT_API_KEY" https://127.0.0.1:6333/readyz
curl --cacert "$QDRANT_TLS_DIR/ca.pem" -fsS \
  -H "api-key: $QDRANT_API_KEY" https://127.0.0.1:6333/collections
```

## Staging Env Projection

The staging runtime env file must point retrieval runtime at this node:

- `/srv/docker/campus-agent/staging/env/runtime.env`

```bash
STAGING_INGESTION_QDRANT_URL=https://127.0.0.1:6333
STAGING_INGESTION_QDRANT_API_KEY=<admin-api-key>
STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=<read-only-api-key>
STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=30
STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
STAGING_INGESTION_EMBEDDING_API_KEY=<embedding-api-key>
STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
STAGING_INGESTION_SPARSE_PROVIDER=qdrant
STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
STAGING_INGESTION_SPARSE_LANGUAGE=none
```

The staging lifecycle script keeps this value as the host-side Qdrant URL. It
projects the container-side runtime URL to
`QDRANT_DOCKER_URL=https://qdrant:6333`. When the URL is local, the lifecycle
script starts repo-owned Qdrant with native TLS, the configured admin key, and
the configured read-only key. Missing Qdrant values, missing CA path, HTTP URL,
or an unreachable container-side Qdrant endpoint fail closed. The same readiness
path creates and deletes a temporary
`bm25_canary_*` collection to prove self-hosted Qdrant can execute
`qdrant/bm25` server-side inference. `/readyz` alone is not enough.

## Create Current Collection Snapshots

Use the filesystem backup worker when release manifests are in the configured
derived bucket and aliases already point to the current physical collections:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.qdrant_filesystem_backup_create \
  --corpus regulations \
  --collection student_rules \
  --release-id <release_id> \
  --output-root /srv/backups/campus-agent/qdrant-snapshots \
  --operator <operator>
```

Repeat for the current query-enabled families:

- `regulations/student_rules`
- `regulations/institutional_rules`
- `curriculum/curriculum_plan`
- `official_web/stable_reference`

Each bundle contains:

- `<physical_collection_name>.snapshot`
- `backup-manifest.json`
- `sha256.txt`
- `restore-command.txt`

`backup-manifest.json` is the alias and release metadata sidecar. Qdrant
collection snapshots do not include aliases.

## Native Snapshot Script

`infra/local/qdrant-native-snapshot.sh` is the direct operator script for
collection snapshot operations.

Create a snapshot:

```bash
QDRANT_URL=https://127.0.0.1:6333 \
QDRANT_API_KEY=<admin-api-key> \
QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem \
  infra/local/qdrant-native-snapshot.sh create-collection \
  --collection <physical_collection> \
  --alias <serving_alias> \
  --corpus <corpus> \
  --logical-collection <collection> \
  --release-id <release_id> \
  --manifest-key <index_release_manifest_key> \
  --output-root /srv/backups/campus-agent/qdrant-snapshots \
  --operator <operator>
```

Restore a snapshot:

```bash
cd /srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>
QDRANT_URL=https://127.0.0.1:6333 \
QDRANT_API_KEY=<admin-api-key> \
QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem \
  qdrant-native-snapshot.sh restore-collection \
  --collection <target_physical_collection> \
  --snapshot <physical_collection>.snapshot \
  --manifest backup-manifest.json \
  --apply-alias
```

Restore validation is fail-closed:

- snapshot file must exist
- `backup-manifest.json` must exist
- snapshot SHA-256 must match manifest
- `sha256.txt`, when present, must match the same checksum
- manifest physical collection records the source physical collection
- restored point count must match manifest
- restored payload must match `index_release_id`,
  `index_release_manifest_key`, and `index_release_alias`

`--collection` may be the original physical collection or an isolated drill
target collection. `--apply-alias` updates aliases from `backup-manifest.json`;
when the target collection differs from the manifest source collection, alias
bindings are remapped to the target collection. Without `--apply-alias`, restore
only loads the physical collection and prints the alias bindings.

## Retention

Recommended retention:

- local daily snapshots: 14 days
- local weekly snapshots: 8 weeks
- off-host daily snapshots: 14 days
- migration baseline snapshots: at least 30 days

Do not delete an old physical collection unless:

1. it is not the current alias target
1. it is not the latest manifest `previous_physical_collection_name`
1. it is not a protected migration baseline
1. release manifest and validation summary exist
1. current native snapshot coverage exists
1. no active incident, regression investigation, or manual review is using it

Historical object-store backup cleanup is separate:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.qdrant_backup_cleanup plan \
  --output-dir var/qdrant-backup-cleanup/<run_id> \
  --current-alias student_rules=<physical_collection> \
  --obsolete-family regulations/student_handbook

uv run --all-packages python -m \
  campus_ingestion_worker.qdrant_backup_cleanup delete \
  --plan-path var/qdrant-backup-cleanup/<run_id>/deletion-plan.json \
  --output-dir var/qdrant-backup-cleanup/<run_id>
```

The cleanup command only deletes exact object keys listed in the deletion plan.
It is not the native backup path.

## Off-Host Archive

The local filesystem is not disaster recovery by itself. After creating current
snapshots, copy the completed bundle directory to an off-host archive target:

```bash
rsync -a --checksum \
  <bundle-dir>/ \
  <off-host-target>/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/
```

The off-host archive must preserve `backup-manifest.json`, `sha256.txt`, and
`restore-command.txt` with the snapshot file.

## Restore Drill

At least once per release window:

1. restore one snapshot into an isolated target collection name
1. do not apply alias on the first pass
1. verify point count and release payload
1. run retrieval acceptance against the isolated collection or a temporary alias
1. record the drill result next to the bundle or in operator evidence

Only real restore drills prove the backup is usable.

## References

- ADR: `docs/decisions/adr-0052-self-hosted-single-node-qdrant-and-native-backups.md`
- Qdrant snapshots: <https://qdrant.tech/documentation/operations/snapshots/>
- Qdrant security: <https://qdrant.tech/documentation/operations/security/>

## Release Manifest Reconstruction Boundary

Native Qdrant snapshots are the backup source of truth for vector collections.
R2 / S3-compatible object storage carries serving artifacts such as
`index-release.json`, validation evidence and reader assets; it must not carry
Qdrant `.snapshot` files.

If a live Qdrant alias and native snapshot bundle exist but the derived bucket
is missing the corresponding `index-release.json`, reconstruct the manifest
with the repo-owned repair command. This is an exceptional recovery path, not
the normal release publication path:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.reconstruct_rag_release_manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-manifest-reconstruction.json
```

After reviewing the dry-run report, perform the write explicitly:

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.reconstruct_rag_release_manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-reconstruction-write.json \
  --write
```

The command fails closed when alias, native snapshot manifest, Qdrant release
payload, point count or target manifest key do not agree. It computes
deterministic document hashes from live Qdrant payload document refs and
records `reconstruction_source`; it does not fabricate original ingestion
hashes.
