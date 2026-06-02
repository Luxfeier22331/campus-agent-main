---
doc_type: runbook
status: active
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
`docs/runbooks/qdrant-cloud-backup-and-restore-runbook.md`.

## Runtime Contract

Early production and staging use one self-hosted Qdrant node.

Required host layout:

- app root: `/srv/apps/campus-agent`
- Qdrant storage: `/srv/lib/campus-agent/qdrant/storage`
- native snapshot archive:
  `/srv/backups/campus-agent/qdrant-snapshots/native`
- restore/archive bundles:
  `/srv/backups/campus-agent/qdrant-snapshots/<corpus>/<collection>/<release_id>/<backup_id>/`

Network contract:

- bind REST and gRPC to `127.0.0.1` or a private interface
- do not expose `6333` or `6334` directly to the public internet
- use API key authentication
- query runtime receives `QDRANT_URL` and `QDRANT_API_KEY` through deployment
  secrets only

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
```

Start Qdrant. Create the shared Docker data-plane network first. Qdrant keeps
host-side ports bound to loopback, while supervisor containers reach it through
Docker service DNS `http://qdrant:6333` on `campus-agent-data-plane`:

```bash
cd /srv/apps/campus-agent
docker network inspect campus-agent-data-plane >/dev/null 2>&1 || \
  docker network create campus-agent-data-plane >/dev/null
docker compose --env-file .env.qdrant.local \
  -f infra/local/docker-compose.qdrant-single-node.yml up -d
```

Health checks:

```bash
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/readyz
curl -fsS -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/collections
```

## Staging Env Projection

`/srv/apps/campus-agent/.env.staging.local` must point retrieval runtime at this
node:

```bash
STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
STAGING_INGESTION_QDRANT_API_KEY=<admin-or-runtime-api-key>
STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=<read-only-api-key>
STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=30
```

The staging lifecycle script keeps this value as the host-side Qdrant URL. It
projects the container-side runtime URL to
`QDRANT_DOCKER_URL=http://qdrant:6333`. When the URL is local, the lifecycle
script starts repo-owned Qdrant with the configured admin and read-only keys.
Missing Qdrant values or an unreachable container-side Qdrant endpoint fail
closed.

## Create Current Collection Snapshots

Use the filesystem backup worker when release manifests are in the configured
derived bucket and aliases already point to the current physical collections:

```bash
uv run --all-packages campus-ingestion-qdrant-filesystem-backup-create \
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
QDRANT_URL=http://127.0.0.1:6333 QDRANT_API_KEY=<admin-api-key> \
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
QDRANT_URL=http://127.0.0.1:6333 QDRANT_API_KEY=<admin-api-key> \
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
uv run --all-packages campus-ingestion-qdrant-backup-cleanup plan \
  --output-dir var/qdrant-backup-cleanup/<run_id> \
  --current-alias student_rules=<physical_collection> \
  --obsolete-family regulations/student_handbook

uv run --all-packages campus-ingestion-qdrant-backup-cleanup delete \
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

- ADR: `docs/decisions/adr-0045-self-hosted-single-node-qdrant-and-native-backups.md`
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
uv run --all-packages campus-ingestion-reconstruct-rag-release-manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-manifest-reconstruction.json
```

After reviewing the dry-run report, perform the write explicitly:

```bash
uv run --all-packages campus-ingestion-reconstruct-rag-release-manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-reconstruction-write.json \
  --write
```

The command fails closed when alias, native snapshot manifest, Qdrant release
payload, point count or target manifest key do not agree. It computes
deterministic document hashes from live Qdrant payload document refs and
records `reconstruction_source`; it does not fabricate original ingestion
hashes.
