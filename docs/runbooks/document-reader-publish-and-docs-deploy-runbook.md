---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-06-10
---

# Document Reader Publish And Campus Docs Deploy Runbook

## 用途

这份 runbook 固定 campus-web 文档阅读面的发布链路：

- `canonical artifacts -> reader-assets`
- `reader-assets -> app-api docs read model`
- `app-api docs read model -> campus-web Rspress reader assets`

它负责 docs reader publish/deploy 的可重复操作顺序。Q&A source-card UI、Rspress
theme 设计和文档内容采集不在本 runbook 内。

## 固定职责

- `ingestion-core` / `ingestion-worker` 负责从 canonical artifacts 生成
  `reader.json`、`outline.json`、`meta.json`、`asset-manifest.json` 与 docs
  read-model manifest。
- `app-api` 负责导入 `docs.*` read model，并导出 docs sync manifest。
- `campus-web` 负责在 build/deploy 期间按 manifest 生成 Rspress source，并把 object
  storage reader assets 复制到 campus-web static delivery roots。
- `campus-web` 不扫描对象存储决定公开文档子集。
- `apps/public-docs` 已退出 forward product topology；其中 Rspress/MDX/anchor/
  highlight/search 管线只作为 reference implementation。
- reader publisher 与 `app-api` docs read-model import 都必须 fail closed unsupported
  scope。`campus_notices/internal_notice` 是 notice source/card scope，不是文档站
  document scope。

当前脚本命名说明：

- `app-api` 的导出命令仍叫 `docs:export-public-sync-manifest`。
- staging smoke 仍读取 `PUBLIC_DOCS_SYNC_MANIFEST_PATH`。
- 这些历史命名只表示“面向浏览器文档阅读面的发布 manifest”，不表示
  `apps/public-docs` 仍是产品入口。

## Seed 数据交付口径

文档阅读 seed 数据交付的是已经发布的 reader/read-model artifact，不是采集任务本身。
接手者不需要重新运行官方站、通知站或手册采集器，也不应接收 raw collector output 作为
document-site seed truth。

交付包必须包含：

- 代码修订：用于生成与消费 seed artifact 的 repo commit 或 release branch。
- docs read-model manifest：`var/docs-read-model-manifest.json`，供 `app-api`
  导入 `docs.*` read model。
- docs sync manifest：`var/public-docs-sync-manifest.json` 或环境后缀文件，供
  `campus-web` 构建 Rspress reader assets。
- 对象存储 reader assets：sync manifest 中 `sourceObjects` 指向的对象，以及当前
  reader manifest object，例如
  `public_docs/releases/reader_assets/current/public-docs-reader-assets.json`。
- 环境配置说明：对象存储 endpoint、region、bucket、access key/secret，以及需要导入
  read model 时使用的 `APP_API_OPERATOR_DATABASE_URL` 或
  `STAGING_APP_API_OPERATOR_DATABASE_URL`。
- 验收摘要：文档数、公开/受限数量、reader asset 数、search unit 数、manifest digest
  或文件 checksum。

`public_docs/releases/...` 是已存在对象存储 prefix 名称；它不是 browser product
surface 名称，后续对象 key 迁移应单独冻结。

禁止把以下内容当作 seed handoff：

- `apps/campus-web/docs/docs/`、`apps/campus-web/public/_docs/`、
  `apps/campus-web/public/_gated-docs/`、`apps/campus-web/doc_build/` 或 repo-root
  `var/` 中的本地生成产物提交进 git。
- 缺少对象存储 reader assets 的单独 manifest。
- 需要接手者重新采集源站才能得到正文的说明。
- 从对象存储扫描推导公开文档子集的脚本或手工步骤。

如果接手者只需要静态站点预览，可以单独传递一次构建后的
`apps/campus-web/doc_build/` artifact；这只适用于静态验收，不替代
`docs-read-model-manifest.json`、docs sync manifest 与对象存储 reader assets 组成的
可重复 seed 交付包。

## 本地发布顺序

### 1. 发布 reader assets 与 read-model manifest

如需修复历史课程地图 reader supplement，先执行一次性 surface 迁移：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.migrate_curriculum_course_map_docs_surfaces
```

如需 backfill 缺失的 canonical markdown，先执行显式 backfill。该步骤只修复缺失的
canonical artifact，不在 reader publish 阶段临时合成正文：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.backfill_missing_canonical_markdown_from_document_units
```

发布 reader assets 与 docs read-model manifest：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.publish_document_reader_assets \
  --manifest-path var/docs-read-model-manifest.json \
  --manifest-object-key public_docs/releases/reader_assets/current/public-docs-reader-assets.json
```

可用 `--dry-run` 验证读取 canonical artifacts 与生成 manifest，不写入 reader assets，
也不会上传 manifest object。

允许进入 docs reader / docs read-model 的 scope 固定为：

- `curriculum/curriculum_plan`
- `regulations/student_rules`
- `regulations/institutional_rules`

`regulations/scoped_rules` 当前是院级/专项 regulation holding collection，不进入当前
document-site read-model、docs sync manifest 或默认 RAG consumption。

### 2. 迁移并导入 app-api docs read model

```bash
pnpm --filter app-api db:migrate
pnpm --filter app-api docs:import-read-model ../../var/docs-read-model-manifest.json
```

staging 使用：

```bash
pnpm --filter app-api db:migrate:staging
pnpm --filter app-api docs:import-read-model:staging ../../var/docs-read-model-manifest.json
```

### 3. 从 app-api read model 导出 docs sync manifest

```bash
pnpm --filter app-api docs:export-public-sync-manifest ../../var/public-docs-sync-manifest.json
```

staging 使用：

```bash
pnpm --filter app-api docs:export-public-sync-manifest:staging ../../var/public-docs-sync-manifest.staging.json
```

该 manifest 也是 staging gated docs smoke 的默认目标来源：
`pnpm --dir apps/app-api docs:gated:smoke:staging` 会读取
`PUBLIC_DOCS_SYNC_MANIFEST_PATH`，未设置时使用 repo-root
`var/public-docs-sync-manifest.staging.json`，并据此选择 gated reader 与匿名 collection
navigation 期望状态。

### 4. 同步 campus-web Rspress source 与 reader assets

本地或 staging build 前先同步 published reader：

```bash
CAMPUS_DOCS_SYNC_MANIFEST_PATH=../../var/public-docs-sync-manifest.json \
  pnpm --filter campus-web docs:sync:published-reader
```

staging manifest：

```bash
export CAMPUS_DOCS_SYNC_MANIFEST_PATH="../../var/public-docs-sync-manifest.staging.json"
pnpm --filter campus-web docs:sync:published-reader
```

若 manifest 来自对象存储而不是本地文件，使用：

```bash
export CAMPUS_DOCS_SYNC_MANIFEST_KEY="public_docs/releases/reader_assets/current/public-docs-reader-assets.json"
export OBJECT_STORE_ENDPOINT=<endpoint>
export OBJECT_STORE_DERIVED_BUCKET=<bucket>
export OBJECT_STORE_ACCESS_KEY=<access-key>
export OBJECT_STORE_SECRET_KEY=<secret-key>
pnpm --filter campus-web docs:sync:published-reader
```

固定规则：

- `docs:sync:published-reader` 只按 manifest 写入 generated Rspress source 与
  `public/_docs` / `public/_gated-docs`。
- `public_static_asset` 生成 Rspress MDX reader page。
- `gated_asset` 只同步 gated reader static assets，不生成匿名 reader page。
- sync 后必须运行 `pnpm --filter campus-web docs:build`，由 Rspress 生成 `/docs/*`
  reader output。

### 5. 构建并部署 campus-web

本地 build：

```bash
pnpm --filter campus-web build
```

staging deploy：

```bash
pnpm --filter campus-web deploy:staging
```

`campus-web` build 会先运行 `docs:build`，再运行 Vite build 与 bundle budget check。
`wrangler.toml` 必须允许 `/docs/*`、`/static/*`、`/vendor/*` 由 static assets delivery
处理，同时 Worker 继续显式代理 `/api/docs/*`，不得开放 generic `/api/*`。

## 验证

本地验证：

```bash
pnpm --filter campus-web docs:build
pnpm --filter campus-web test:node -- test/docs-published-reader-sync.test.ts
pnpm --filter campus-web test:node -- test/docs-reader-state.test.ts
pnpm --filter campus-web test:worker -- test/campus-worker.test.ts
```

收口验证：

```bash
pnpm --filter campus-web test:node
pnpm --filter campus-web test:worker
pnpm --filter campus-web typecheck
pnpm --filter campus-web build:staging
pnpm docs:lint
pnpm decomposition:lint
git diff --check
```

staging gated docs smoke：

```bash
pnpm --dir apps/app-api docs:gated:smoke:staging
```

通过标准：

- `/docs/*` 在 campus-web origin 下返回 Rspress reader 页面。
- `/api/docs/*` 仍由 campus-web Worker 显式代理到 `app-api`。
- unknown `/api/*`、`/api/ops/*` 继续 fail closed。
- reader asset URL 不包含 `localhost`、`127.0.0.1` 或对象存储 endpoint。
- Q&A source card、docs search result 和直接阅读都生成
  `/docs/:corpus/:collection/:docSlug?hl=<rootUnitId>#<anchor>` 语义 URL。
- active deploy/smoke 不再要求部署独立 docs staging hostname。

## 回滚

如果 campus-web docs build 生成错误：

- 不扫描对象存储补救。
- 不在 React `DocsPage` 临时自研 reader。
- 先修复 app-api 导出的 docs sync manifest、reader asset package 或 Rspress source
  generator，再重新构建 campus-web。

如果已发布 campus-web Worker bundle 错误，按 Worker version 回滚；reader manifest digest
不能替代 Worker rollback identity。

## 相关稳定文档

- `docs/architecture/system/document-site-architecture.md`
- `docs/contracts/app-api-document-reader-http.md`
- `docs/contracts/document-reader-publish-contract.md`
- `docs/decisions/adr-0051-campus-docs-rspress-reader-surface.md`
