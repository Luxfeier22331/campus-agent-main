---
doc_type: runbook
status: active
created: 2026-04-27
updated: 2026-04-29
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

该 manifest 也是 staging gated docs smoke 的默认目标来源：
`pnpm --dir apps/app-api docs:gated:smoke:staging` 会读取
`PUBLIC_DOCS_SYNC_MANIFEST_PATH`，未设置时使用 repo-root
`var/public-docs-sync-manifest.json`，并据此选择 gated reader 与匿名 collection
navigation 期望状态。

### 4. 滚动检查并按需发布 public-docs

GitHub Actions workflow `.github/workflows/public-docs-rolling-publish.yml` 是生产
rolling publish 的 controlled runner。它在 UTC `7 4,10,16,22 * * *` 调用 publish
pipeline；这对应上海时间 `00:07 / 06:07 / 12:07 / 18:07`，仍落在 accepted
`00:00 / 06:00 / 12:00 / 18:00` 的 15 分钟窗口内。

workflow 每次先运行 production acceptance harness，再执行 rolling publish pipeline。
pipeline 先下载持久 release ledger，执行 scheduled manifest check 与 single-flight lock；
只有 manifest verdict 为 `changed` 时才继续 build、build-output smoke、deploy config
verify 和 Wrangler deploy。pipeline 完成后把非 dry-run 的 ledger 写回对象存储。

生产开关：

- `PUBLIC_DOCS_ROLLING_PUBLISH_ENABLED=true` 才允许 workflow 进入真实 publish runner。
- `PUBLIC_DOCS_ROLLING_PUBLISH_DRY_RUN=true` 默认只 dry-run，不写回持久 ledger。
- `PUBLIC_DOCS_SYNC_MANIFEST_KEY` 指向 ingestion/app-api 发布的 current manifest object。
- `PUBLIC_DOCS_RELEASE_LEDGER_KEY` 指向 public-docs release ledger object。

GitHub Environment secrets / vars 需要至少包含：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_REGION`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `PUBLIC_DOCS_SYNC_MANIFEST_KEY`
- `PUBLIC_DOCS_RELEASE_LEDGER_KEY`
- `PUBLIC_DOCS_ROLLING_PUBLISH_ENABLED`
- `PUBLIC_DOCS_ROLLING_PUBLISH_DRY_RUN`

本地或 operator shell 仍可使用文件 ledger。该 runtime state 默认放在
`.planning/runtime/public-docs-publish/`，不应提交。

生产 workflow 等价命令：

```bash
pnpm --filter public-docs publish:rolling -- \
  --env prod \
  --output public-docs-publish-result.json
```

如果需要在 workflow/manual dispatch 中显式 dry-run：

```bash
pnpm --filter public-docs publish:rolling -- \
  --env prod \
  --dry-run \
  --output public-docs-publish-result.json
```

如果需要手动强制跳过 schedule window：

```bash
pnpm --filter public-docs publish:rolling -- \
  --env prod \
  --force \
  --output public-docs-publish-result.json
```

底层 scheduled deploy pipeline 仍可直接调用，主要用于本地调试：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs deploy:published-reader-scheduled -- \
  --env prod
```

手动强制执行一轮检查与按需发布：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs deploy:published-reader-scheduled -- \
  --env prod \
  --force \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

只看将要执行的命令、不执行 build/smoke/deploy：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs deploy:published-reader-scheduled -- \
  --env prod \
  --force \
  --dry-run \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

manifest-only dry-run 仍可直接调用：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs check:published-reader-manifest -- \
  --env prod \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json
```

这个检查只读取 manifest、对象存储 reader assets 与 release ledger，不执行 build 或
deploy。输出 JSON verdict：

- `changed`：manifest digest 相对上次成功部署已变化，可以进入 build/deploy。
- `unchanged`：manifest digest 已是上次成功部署版本，本轮应跳过。
- `invalid`：manifest JSON / schema 不合法，不允许进入 build/deploy。
- `blocked`：发现缺失 source object、hash/size 不一致、重复 target 或 gated asset
  误入 public path 等发布阻断问题。

如果需要把本轮检查记录写入 ledger，显式追加 `--write-ledger`。默认 dry-run 不改写
ledger。

staging 使用：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs deploy:published-reader-scheduled -- \
  --env staging
```

### 4.1 可选即时 deploy-hook nudge

如果 ingestion 在 scheduled window 之后刚发布了新的 current manifest，可以发出即时
nudge，缩短最长 6 小时的等待时间。这个入口只负责触发检查，不是第二套发布真相源：

- payload 只允许表达 `surface=public_docs`、`environment`、`eventId` 与 source
  metadata。
- payload 中的 manifest digest、release id、object key 或 branch 一律不可信，不参与
  部署判定。
- runner 仍读取配置的 current manifest path / object key，并继续执行 manifest
  validation、digest comparison、single-flight lock、build-output smoke 和 deploy
  pipeline。
- shared secret 用于本地 / CI webhook adapter；Cloudflare Deploy Hook URL 自身就是
  credential，必须作为 secret 保存。
- Cloudflare Deploy Hook 多次触发可能返回同一个 queued / initializing build；本链路必须
  依赖 ledger 和 manifest digest 保持幂等。

受控 runner 本地执行 pipeline：

```bash
cat > var/public-docs-deploy-hook-payload.json <<'JSON'
{
  "surface": "public_docs",
  "environment": "prod",
  "eventId": "ingest-20260429-1"
}
JSON

PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs nudge:published-reader-deploy-hook -- \
  --env prod \
  --payload-path var/public-docs-deploy-hook-payload.json \
  --secret "$PUBLIC_DOCS_DEPLOY_HOOK_SECRET" \
  --payload-secret "$INCOMING_PUBLIC_DOCS_DEPLOY_HOOK_SECRET" \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

只转发到 Cloudflare Workers Builds Deploy Hook URL：

```bash
pnpm --filter public-docs nudge:published-reader-deploy-hook -- \
  --env prod \
  --deploy-hook-url "$PUBLIC_DOCS_DEPLOY_HOOK_URL" \
  --payload-json '{"surface":"public_docs","environment":"prod","eventId":"ingest-20260429-1"}'
```

这个 dispatch 模式只发 HTTP `POST` 到 Deploy Hook URL，由 Cloudflare Builds 负责启动
配置好的构建。测试和 dry-run 不应调用真实 Deploy Hook URL。

### 4.2 生产发布验收 harness

上线前或修改 rolling publish 逻辑后，运行本地 acceptance harness。它使用临时
ledger/lock、内存 object store、注入 command runner 和注入 `fetch`，不会调用真实
Cloudflare deploy、rollback 或 Deploy Hook URL。

```bash
pnpm --filter public-docs acceptance:published-reader-production -- \
  --output .planning/workstreams/public-docs-rolling-publish-automation/evidence/phase-6-production-acceptance-and-operator-runbook/acceptance.json
```

验收 JSON 必须满足：

- `status=passed`
- `summary.failed=0`
- 覆盖 prod/staging dry-run、no-change、changed deploy、invalid/blocked、lock-busy、
  failed command、rollback dry-run、hook local nudge 与 hook dispatch。

### 5. 手动构建和 build-output smoke

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

构建后可单独验证 build output 是否包含 manifest 声明的 reader assets：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs smoke:published-reader-build
```

### 6. 手动部署 staging

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs deploy:staging
```

如果只验证 Worker config，不发布：

```bash
pnpm --filter public-docs deploy:verify-config:staging
```

### 7. 验证 gated static admission

部署后，用同一登录态访问任意受限路径（`/_gated-docs/...`）：

- 已授权 principal：应返回正文资产（`200`，`Cache-Control: no-store`）
- 未授权 principal：应 fail-close（`404`）
- `public-docs` 只通过 same-site `/api/docs/.../admission` 做校验，不直连对象存储

### 8. 失败处理与重试

`invalid` / `blocked` manifest 不是发布重试问题。先修复 upstream manifest /
reader assets，再重新进入 scheduled deploy pipeline。

`unchanged`、`not_due`、`lock_busy` 也不是发布失败：

- `unchanged` 表示当前 digest 已经成功部署。
- `not_due` 表示不在 accepted schedule window。
- `lock_busy` 表示另一条 publish / rollback runner 正在持有 single-flight lock。

build / smoke / verify / deploy command 失败会追加 final `failed` ledger 记录，不会追加
`deployed`。确认失败原因后，如果 candidate manifest digest 仍然是 current manifest，
并且没有更新的 `deployed` 记录 supersede 该失败记录，可以显式 retry：

```bash
PUBLIC_DOCS_SYNC_MANIFEST_PATH=var/public-docs-sync-manifest.json \
  pnpm --filter public-docs retry:published-reader-release -- \
  --env prod \
  --record-id <failed-ledger-record-id> \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

retry 会追加带 `retryOfRecordId` 与 `attemptNumber` 的新 ledger 记录，不会修改原
`failed` 记录。

### 9. 回滚 public-docs Worker

Cloudflare Workers rollback 使用 Worker version id，而不是 public-docs manifest digest
或 deployment id。成功部署记录应尽量包含 `cloudflareVersionId`；如果旧 ledger 只保留
deployment id，必须由 operator 显式提供 `--target-version-id`。

Cloudflare rollback 会创建一个新的 deployment 并立即把流量切回目标 version。Cloudflare
文档同时说明 rollback 不会改变外部绑定资源；如果 Worker 依赖的外部资源、bindings 或
Developer Platform resources 已变化或消失，rollback 可能失败或需要额外人工恢复。

dry-run 查看 rollback 命令：

```bash
pnpm --filter public-docs rollback:published-reader-release -- \
  --env prod \
  --dry-run \
  --target-release-id <previous-release-id> \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

执行 rollback：

```bash
pnpm --filter public-docs rollback:published-reader-release -- \
  --env prod \
  --target-release-id <previous-release-id> \
  --reason "rollback bad public docs release" \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

如果没有 release id 对应的 version evidence：

```bash
pnpm --filter public-docs rollback:published-reader-release -- \
  --env prod \
  --target-version-id <cloudflare-worker-version-id> \
  --reason "rollback bad public docs release" \
  --ledger .planning/runtime/public-docs-publish/prod-ledger.json \
  --lock-file .planning/runtime/public-docs-publish/prod.lock.json
```

rollback 成功会追加 `rolled_back` ledger 记录，包含 target record / release /
version、reason 和 rollback command，不会修改旧 `deployed` 或 `failed` 记录。

## 验收点

- `deploy:published-reader-scheduled` 在 `not_due`、`lock_busy`、`unchanged`、
  `invalid`、`blocked` 时不执行 build/smoke/deploy。
- `deploy:published-reader-scheduled` 只在 `changed` 时执行 build、build-output
  smoke、deploy config verify 与 Wrangler deploy。
- ledger 中的 final `deployed` 记录只在 build、smoke、verify 和 deploy 全部成功后追加。
- 任一 build/smoke/verify/deploy 失败时只追加 final `failed` 记录，不追加
  `deployed`。
- `retry:published-reader-release` 不允许 retry `invalid` / `blocked` manifest 或
  已被更新部署 supersede 的失败 candidate。
- `rollback:published-reader-release` 只接受可解析到 Worker version id 的 target，
  并通过 single-flight lock 执行。
- rollback 成功只追加 `rolled_back` 记录，不修改历史 ledger 记录。
- `nudge:published-reader-deploy-hook` 只记录 `trigger=hook` 并复用同一 manifest
  validation / digest comparison / lock / deploy pipeline，不信任 payload 中的 release
  truth。
- `app-api` 的 `/api/docs/*` 只返回 public current static subset。
- docs read-model manifest 中的 `collections` 与 `documents` 不包含
  `campus_notices/internal_notice`。
- `/api/docs/*` response 不包含 object storage key、raw provider locator 或
  `chunkId`。
- `public-docs` build output 包含 Rspress reader pages、`/_docs/...` 与
  `/_gated-docs/...` static assets。
- restricted reader asset 只经 `/_gated-docs/...` 返回，且必须在 Worker 内先走
  same-site `/api/docs/.../admission` 校验后再读取静态资产。
- restricted collection landing 由 `collection-bootstrap.html` 在客户端经 same-site
  `/api/docs/collections/:corpus/:collection/navigation` 读取已授权标题与 canonical
  URL；不得生成匿名 static MDX，也不得暴露正文、object key 或 raw provider locator。
- gated reader asset response 必须设置 `Cache-Control: no-store` 与 `Vary: Cookie, Authorization`。
- 缺失 source object、重复 target object、unsafe target path 或 hash/size 不一致时，
  manifest check / sync 必须失败。

## 回滚

- 如果 `docs.*` read model 导入错误，重新导入上一份已知好的
  `docs-read-model-manifest.json`。
- 如果 `public-docs` bundle 错误，不重新扫描对象存储；应修复 app-api 导出的
  sync manifest 或重新执行 reader publisher。
- 如果已发布的 public-docs Worker bundle 错误，按第 9 节使用 Worker version id
  回滚；不要用对象存储扫描或手工改 bucket 代替 rollback。
- 不要把 `apps/public-docs/docs/` 生成内容提交进 git；它只属于 build-time source
  staging。
