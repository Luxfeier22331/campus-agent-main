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
- `apps/public-docs` 已退出 forward product topology 并从 active workspace 删除；历史
  Rspress/MDX/anchor/highlight/search 管线只能通过 git history 追溯。
- reader publisher 与 `app-api` docs read-model import 都必须 fail closed unsupported
  scope。`campus_notices/internal_notice` 是 notice source/card scope，不是文档站
  document scope。

当前脚本命名说明：

- `app-api` 的导出命令仍叫 `docs:export-public-sync-manifest`。
- staging smoke 仍读取 `PUBLIC_DOCS_SYNC_MANIFEST_PATH`。
- 这些历史命名只表示“面向浏览器文档阅读面的发布 manifest”，不表示已删除的
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
  docs read-model manifest object，例如
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
  `apps/campus-web/public/_gated-docs/`、`apps/campus-web/public/_gated-docs-search/`、
  `apps/campus-web/doc_build/` 或 repo-root `var/` 中的本地生成产物提交进 git。
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

如果 registry 当前指向的 `regulations/institutional_rules` 记录缺少
`canonical.md`，不要在 reader publish 阶段临时合成正文。旧的 Python
canonical markdown backfill 执行入口已经从 active worker surface 删除；需要恢复时应按
ingestion-control task / Rust kernel 目标形态重新建模。

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
- `regulations/scoped_rules`

`regulations/scoped_rules` 当前仍不是默认 RAG / query-enabled surface；它只允许作为
`gated_asset` reader document 进入 document-site read-model 与 docs sync manifest，由
`app-api` 做 reader admission，不得因此进入匿名公开正文、默认问答 scope 或 index release
allowlist。

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

本地 `docs:sync:published-reader` 会先加载当前 worktree 的 repo-root `.env`
以及 `apps/campus-web/.env` / `.dev.vars`。`infra/local/docker-compose.minio.yml`
只负责启动本机 MinIO；Docker compose 里的 `${OBJECT_STORE_*:-minioadmin}` 默认值不会自动进入
Node / pnpm build 进程。每个 worktree 需要自己具备 `.env`，至少包含：

```bash
OBJECT_STORE_ENDPOINT=http://localhost:9000
OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived
OBJECT_STORE_ACCESS_KEY=minioadmin
OBJECT_STORE_SECRET_KEY=minioadmin
```

staging manifest：

```bash
export CAMPUS_DOCS_SYNC_MANIFEST_PATH="../../var/public-docs-sync-manifest.staging.json"
pnpm --filter campus-web docs:sync:published-reader
```

若 docs sync manifest 来自对象存储而不是本地文件，使用一只包含 `entries[]` 的
sync manifest object：

```bash
export CAMPUS_DOCS_SYNC_MANIFEST_KEY="<docs-sync-manifest-object-key>"
export OBJECT_STORE_ENDPOINT=<endpoint>
export OBJECT_STORE_BUCKET_DERIVED=<bucket>
export OBJECT_STORE_ACCESS_KEY=<access-key>
export OBJECT_STORE_SECRET_KEY=<secret-key>
pnpm --filter campus-web docs:sync:published-reader
```

固定规则：

- `docs:sync:published-reader` 只按 manifest 写入 generated Rspress source 与
  `public/_docs` / `public/_gated-docs` / `public/_gated-docs-search`。
- published reader Rspress source 固定写入 `apps/campus-web/.generated/docs`；tracked
  `apps/campus-web/docs` 只保留 scaffold，不得承载发布生成物。
- `public_static_asset` current version 生成
  `docsSearchVisibility=public_current` 的 Rspress MDX reader page，并进入 Rspress
  native local search index；historical `/v/*` 不进入公开搜索索引。
- Rspress search index plugin 必须只保留 `docsSearchVisibility=public_current` 页面。
- `gated_asset` 同步 gated reader static assets，并生成无正文 Rspress bootstrap
  reader page；该 page 只能通过 same-origin `/api/docs/*` resolve/admission 后读取正文，
  不得把 gated 文档标题或 slug 放进匿名 collection index 或公开 Rspress index。
- `gated_asset` current version 必须生成
  `public/_gated-docs-search/:corpus/:collection/:documentSlug/:versionSlug/index.json`，
  由 campus-web Worker admission 后交付，并在浏览器本地执行字面查询。
- sync 后必须运行 `pnpm --filter campus-web docs:build`，由 Rspress 生成 `/docs/*`
  reader output 与公开 current 文档 native local search index。

### 5. 构建并部署 campus-web

本地 build：

```bash
pnpm --filter campus-web build
```

staging deploy：

```bash
pnpm --filter campus-web deploy:staging
```

`campus-web` build 会先运行 `docs:build`；该命令等价于
`docs:build:published-reader`，必须读取 docs sync manifest 与对象存储 reader assets。
`build:staging` 会改走 `docs:build:published-reader:staging`，由
`scripts/run-with-staging-ingestion-env.mjs` 从 `.env.staging.local` 的
`STAGING_INGESTION_OBJECT_STORE_*` 显式投影出 `OBJECT_STORE_*`，不得从本地 `.env`
或 Docker MinIO 默认值补齐 staging 配置。
`docs:build:scaffold` 只用于本地 Rspress 编译/视觉 sanity，不得作为 product 或 staging
文档验收。

随后 build 继续运行 Vite build 与 bundle budget check。
`wrangler.toml` 必须允许 `/docs/*`、`/static/*`、`/vendor/*` 由 static assets delivery
处理；`/_gated-docs/*` 与 `/_gated-docs-search/*` 必须走 Worker-first admission。
Worker 继续显式代理允许的 `/api/docs/*`，不得开放 generic `/api/*`。

## 验证

本地验证：

```bash
pnpm --filter campus-web docs:build:scaffold
pnpm --filter campus-web test:node -- test/docs-published-reader-sync.test.ts
pnpm --filter campus-web test:node -- test/docs-reader-state.test.ts
pnpm --filter campus-web test:worker -- test/campus-worker.test.ts
```

`docs:build:scaffold` 只验证 Rspress/theme/global UI 可以编译。发布验收必须在设置
`CAMPUS_DOCS_SYNC_MANIFEST_PATH` 或 `CAMPUS_DOCS_SYNC_MANIFEST_KEY` 后运行
`pnpm --filter campus-web docs:build` / `build:staging`，否则应 fail closed。

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
- anonymous-visible docs search 消费 Rspress native local search；公开文档站 UI 不再调用
  `/api/docs/*/search`。
- Rspress public search index 只包含 anonymous-visible current reader pages，不包含
  gated/restricted、bootstrap、collection index 或 historical `/v/*` 页面。
- gated/restricted docs search 消费 `/_gated-docs-search/*` 受保护静态 index；查询词不发送到
  app-api，不复用公开索引。
- reader asset URL 不包含 `localhost`、`127.0.0.1` 或对象存储 endpoint。
- Q&A source card、docs search result 和直接阅读都生成 reader permalink：
  `/docs/:corpus/:collection/:docSlug?hl=<rootUnitId>#<anchor>`。
- active deploy/smoke 不再要求部署独立 docs staging hostname。
- docs read-model manifest 中的 `collections` 与 `documents` 不包含
  `campus_notices/internal_notice`。
- `/api/docs/*` response 不包含 object storage key、raw provider locator 或 `chunkId`。
- gated reader asset response 必须设置 `Cache-Control: no-store` 与
  `Vary: Cookie, Authorization`。
- 缺失 source object、重复 target object、unsafe target path 或 hash/size 不一致时，
  manifest check / sync 必须失败。

## Serving Seed Manifest

长期 handoff 不把对象存储大内容提交进 Git。Git 只保存脚本、runbook、manifest
schema 与 checksum 证据；实际 reader assets 继续留在 S3-compatible object storage。

导出 serving seed manifest：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.export_serving_seed \
  --output-path var/serving-seed-manifest.json
```

该命令默认读取 current reader manifest：

```text
public_docs/releases/reader_assets/current/public-docs-reader-assets.json
```

它会把 docs reader manifest 与其中所有 `sourceObjects` 写入
`campus_serving_seed_manifest_v1`，每个对象包含：

- bucket
- key
- role
- sizeBytes
- sha256
- contentType

校验 seed manifest：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.verify_serving_seed \
  --manifest-path var/serving-seed-manifest.json
```

恢复 seed manifest 中声明的对象：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.restore_serving_seed \
  --manifest-path var/serving-seed-manifest.json
```

`verify` 与 `restore` 都按 manifest 的 size / sha256 fail closed；缺对象、大小不一致或
hash 不一致都不得继续。

迁移完成后，旧 derived bucket root
`manifests/public-docs-reader-assets.json` 不再是合法发布目标。清理它必须先重新发布并校验
`public_docs/releases/reader_assets/current/public-docs-reader-assets.json`，再用
derived bucket hygiene audit 产出的 `unexpected-keys.jsonl` 执行：

```bash
uv run --all-packages python -m \
  campus_ingestion_worker.cleanup_derived_bucket_unexpected_keys \
  --candidate-inventory-path <audit-output>/unexpected-keys.jsonl \
  --output-dir <cleanup-output> \
  --yes
```

该 cleanup 命令不接受缺 bucket / reason / object_key 的旧 inventory；需要重新跑 audit
取得完整删除凭证。

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
