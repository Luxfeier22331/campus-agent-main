---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-04-28
---

# Document Reader Publish And Docs Deploy Runbook

## 用途

这份 runbook 固定公开文档站的发布链路，并记录 Phase 6 gated reader
Worker-first 静态交付：

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
  object storage reader assets 复制到 `doc_build/_docs/...` 与 `doc_build/_gated-docs/...`。
- `public-docs` 不扫描对象存储决定公开文档子集。
- `sync-real-docs` 是 legacy/manual path；默认 deploy path 必须走 published reader
  assets。
- reader publisher 与 `app-api` docs read-model import 都必须 fail-close
  unsupported scope。`campus_notices/internal_notice` 是 notice source/card scope，
  不是文档站 document scope。

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

默认 first-launch scope 是：

- `regulations/student_rules`
- `curriculum/curriculum_plan`

允许进入 docs reader / docs read-model 的 scope 固定为：

- `curriculum/curriculum_plan`
- `regulations/student_rules`
- `regulations/institutional_rules`
- `regulations/scoped_rules`

如需显式限制范围：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.publish_document_reader_assets \
  --scope regulations/student_rules \
  --scope curriculum/curriculum_plan \
  --manifest-path var/docs-read-model-manifest.json \
  --manifest-object-key manifests/public-docs-reader-assets.json
```

如需发布 notice-derived regulation target，必须显式选择 target scope，例如：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.publish_document_reader_assets \
  --scope regulations/institutional_rules \
  --scope regulations/scoped_rules \
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
- 按 manifest 复制受限 reader assets 到 `doc_build/_gated-docs/...`
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

### 6. 验证 gated static admission

部署后，用同一登录态访问任意受限路径（`/_gated-docs/...`）：

- 已授权 principal：应返回正文资产（`200`，`Cache-Control: no-store`）
- 未授权 principal：应 fail-close（`404`）
- `public-docs` 只通过 same-site `/api/docs/.../admission` 做校验，不直连对象存储

## 验收点

- `app-api` 的 `/api/docs/*` 只返回 public current static subset。
- docs read-model manifest 中的 `collections` 与 `documents` 不包含
  `campus_notices/internal_notice`。
- `/api/docs/*` response 不包含 object storage key、raw provider locator 或
  `chunkId`。
- `public-docs` build output 包含 Rspress reader pages、`/_docs/...` 与
  `/_gated-docs/...` static assets。
- restricted reader asset 只经 `/_gated-docs/...` 返回，且必须在 Worker 内先走
  same-site `/api/docs/.../admission` 校验后再读取静态资产。
- gated reader asset response 必须设置 `Cache-Control: no-store` 与 `Vary: Cookie, Authorization`。
- 缺失 source object、重复 target object、unsafe target path 或 hash/size 不一致时，
  sync 必须失败。

## 回滚

- 如果 `docs.*` read model 导入错误，重新导入上一份已知好的
  `docs-read-model-manifest.json`。
- 如果 `public-docs` bundle 错误，不重新扫描对象存储；应修复 app-api 导出的
  sync manifest 或重新执行 reader publisher。
- 不要把 `apps/public-docs/docs/` 生成内容提交进 git；它只属于 build-time source
  staging。
