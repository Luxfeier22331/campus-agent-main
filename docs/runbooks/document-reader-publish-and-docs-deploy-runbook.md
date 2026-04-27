---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Document Reader Publish And Docs Deploy Runbook

## 用途

这份 runbook 固定公开文档站的 Phase 2 发布链路，并记录 Phase 6 gated reader
asset staging handoff：

- `canonical artifacts -> reader-assets`
- `reader-assets -> app-api docs read model`
- `app-api docs read model -> public-docs static bundle`

它负责 docs reader publish/deploy 的可重复操作顺序；chat source-card UI 不在本 runbook
内。

## 固定职责

- `ingestion-core` / `ingestion-worker` 负责从 canonical artifacts 生成
  `reader.json`、`outline.json`、`meta.json`、`asset-manifest.json` 与 docs
  read-model manifest。
- `app-api` 负责导入 `docs.*` read model，并导出 public docs sync manifest。
- `public-docs` 负责在 build/deploy 期间按 manifest 生成 Rspress source，并把
  object storage reader assets 复制到 `doc_build/_docs/...`。
- `public-docs` 不扫描对象存储决定公开文档子集。
- `sync-real-docs` 是 legacy/manual path；默认 deploy path 必须走 published reader
  assets。

## 本地发布顺序

### 1. 发布 reader assets 与 read-model manifest

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.publish_document_reader_assets \
  --manifest-path var/docs-read-model-manifest.json \
  --manifest-object-key manifests/public-docs-reader-assets.json
```

可用 `--dry-run` 验证读取 canonical artifacts 与生成 manifest，不写入 reader
assets，也不会上传 manifest object。

默认 scope 是：

- `regulations/student_rules`
- `curriculum/curriculum_plan`

如需显式限制范围：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.publish_document_reader_assets \
  --scope regulations/student_rules \
  --scope curriculum/curriculum_plan \
  --manifest-path var/docs-read-model-manifest.json \
  --manifest-object-key manifests/public-docs-reader-assets.json
```

### 2. 迁移并导入 app-api docs read model

```bash
pnpm --filter app-api db:migrate
pnpm --filter app-api docs:import-read-model -- var/docs-read-model-manifest.json
```

staging 使用：

```bash
pnpm --filter app-api db:migrate:staging
pnpm --filter app-api docs:import-read-model:staging -- var/docs-read-model-manifest.json
```

### 3. 从 app-api read model 导出 public docs sync manifest

```bash
pnpm --filter app-api docs:export-public-sync-manifest -- var/public-docs-sync-manifest.json
```

staging 使用：

```bash
pnpm --filter app-api docs:export-public-sync-manifest:staging -- var/public-docs-sync-manifest.json
```

### 4. 构建 public-docs published reader bundle

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs build:published-reader-assets
```

这个命令会：

- 生成 `apps/public-docs/docs/docs/:corpus/:collection/*.mdx`
- 执行 generated docs guard
- 构建 Rspress `doc_build`
- 按 manifest 复制公开 reader assets 到 `doc_build/_docs/...`
- 校验 `asset-manifest.json` 的 size / sha256

### 5. 部署 staging

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs deploy:staging
```

如果只验证 Worker config，不发布：

```bash
pnpm --filter public-docs deploy:verify-config:staging
```

### 6. 同步 gated reader assets 到 staging R2

restricted reader 不进入 `public-docs` static bundle。staging 需要把 read-model manifest
中 `deliveryMode=gated_asset` 的 `sourceObjects` 复制到 `app-api` 的
`DOCS_READER_ASSETS` binding bucket。

```bash
DOCS_READ_MODEL_MANIFEST_PATH=var/docs-read-model-manifest.json \
DOCS_READER_ASSETS_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
DOCS_READER_ASSETS_R2_ACCESS_KEY=<r2-access-key> \
DOCS_READER_ASSETS_R2_SECRET_KEY=<r2-secret-key> \
DOCS_READER_ASSETS_R2_BUCKET=campus-agent-reader-assets-staging \
  pnpm --filter public-docs sync:gated-reader-assets
```

先做 dry run：

```bash
DOCS_READ_MODEL_MANIFEST_PATH=var/docs-read-model-manifest.json \
DOCS_READER_ASSETS_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
DOCS_READER_ASSETS_R2_ACCESS_KEY=<r2-access-key> \
DOCS_READER_ASSETS_R2_SECRET_KEY=<r2-secret-key> \
DOCS_READER_ASSETS_R2_BUCKET=campus-agent-reader-assets-staging \
  pnpm --filter public-docs sync:gated-reader-assets -- --dry-run
```

## 验收点

- `app-api` 的 `/api/docs/*` 只返回 public current static subset。
- `/api/docs/*` response 不包含 object storage key、raw provider locator 或
  `chunkId`。
- `public-docs` build output 包含 Rspress reader pages 与 `/_docs/...` static assets。
- `gated_asset` 不进入 `doc_build/_docs/...`。
- restricted reader asset response 只经 same-site `/api/docs/.../assets/:assetKind`
  返回，且必须设置 `Cache-Control: no-store` 与 `Vary: Cookie, Authorization`。
- 缺失 source object、重复 target object、unsafe target path 或 hash/size 不一致时，
  sync 必须失败。

## 回滚

- 如果 `docs.*` read model 导入错误，重新导入上一份已知好的
  `docs-read-model-manifest.json`。
- 如果 `public-docs` bundle 错误，不重新扫描对象存储；应修复 app-api 导出的
  sync manifest 或重新执行 reader publisher。
- 不要把 `apps/public-docs/docs/` 生成内容提交进 git；它只属于 build-time source
  staging。
