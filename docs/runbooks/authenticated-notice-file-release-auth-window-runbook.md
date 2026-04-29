---
doc_type: runbook
status: active
created: 2026-04-12
updated: 2026-04-18
---
# Authenticated Notice File-Release Auth-Window Runbook

## 文档边界

这份 runbook 只描述一件事：

- 当拿到新的 authenticated portal operator cookies 后，如何在认证窗口内先做
  `file_release` 预检，再做 bounded export / full export

它不替代：

- `docs/reference/authenticated-notice-file-release-export-contract.md` 的导出契约
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md` 的 notice
  bootstrap import smoke
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 replay /
  preparation 路径

## 适用范围

当前 runbook 只适用于：

- `authenticated_notice_portal/file_release`
- collector side capture / export
- next auth window 的 bounded capture，以及必要时的 full export

当前明确不做：

- ingestion-worker replay
- regulation promotion
- OCR
- chunk preparation
- Qdrant / embedding
- release / alias publish

## 前置条件

- 已有新的 authenticated portal operator cookies：
  - `AUTHENTICATED_NOTICE_SSO_TGC`
  - `AUTHENTICATED_NOTICE_JSESSIONID`
  - `AUTHENTICATED_NOTICE_NGINX`
- root `.env` 或 collector 环境中已配置必要对象存储凭据时，允许源文件 materialization
- 当前从 repo root 执行命令

建议先确认 collector 环境已落盘：

- `AUTHENTICATED_NOTICE_RUNTIME_DIR`
- `AUTHENTICATED_NOTICE_SOURCE_HOME_URL`
- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OBJECT_STORE_BUCKET_SOURCE`
- `AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_DATABASE_URL`
- `AUTHENTICATED_NOTICE_COLLECTOR_LEASE_DATABASE_URL`

说明：

- 当前 collector 的推荐 operator 输入是显式三 cookie：
  - `AUTHENTICATED_NOTICE_SSO_TGC`
  - `AUTHENTICATED_NOTICE_JSESSIONID`
  - `AUTHENTICATED_NOTICE_NGINX`
- `AUTHENTICATED_NOTICE_AUTH_COOKIE_HEADER` 仍可作为兼容输入，但不再是推荐主形态
- 生产 job 应配置 collector lease URL；本地 smoke 可不配置 lease

## 执行顺序

### 1. 保存认证状态

先把新的登录态写入 collector runtime：

```bash
pnpm --dir apps/authenticated-notice-collector auth:save
```

目标：

- 刷新 `storageState`
- 让 collector 后续 `auth:check` / `file-release:export` 复用同一会话

### 2. 先做双-surface 预检

认证窗口内，先跑：

```bash
pnpm --dir apps/authenticated-notice-collector auth:check
```

容器入口等价命令：

```bash
AUTHENTICATED_NOTICE_COLLECTOR_MODE=auth-check \
docker run --rm --env-file .env campus-authenticated-notice-collector:local
```

通过标准：

- `ok=true`
- `notice.sampleCount > 0`
- `fileRelease.sampleCount > 0`

说明：

- 现在的 `auth:check` 同时验证 `/comsys-portal-notice-web/getNoticeByPage`
- 也同时验证 `/comsys-prompt-portlet-web/pageFile`
- 只有两个 authenticated surface 都可访问，才允许继续 `file-release:export`

如果 notice 可用但 `file_release` 不可用：

- 直接 fail-close
- 不要把这次会话当成“可用登录态”

### 3. 先做 targeted export

如果当前 auth window 已经 admission 某个 non-excluded target，这里默认走 targeted
export，不再用“随便抓 1 条”的数量 smoke 代替。

前提：

- operator 已经从 portal 侧确认这次要抓的精确 `file_release_id`
- 该 target 不在当前排除名单中
- 如果还没有这个 id，本 runbook 不授权直接回退到 full export 代替 targeted capture

执行命令：

```bash
AUTHENTICATED_NOTICE_FILE_RELEASE_TARGET_ID=<target_file_release_id> \
pnpm --dir apps/authenticated-notice-collector file-release:export
```

容器入口等价命令：

```bash
AUTHENTICATED_NOTICE_COLLECTOR_MODE=file-release-export \
AUTHENTICATED_NOTICE_FILE_RELEASE_TARGET_ID=<target_file_release_id> \
docker run --rm --env-file .env campus-authenticated-notice-collector:local
```

如需同时验证源文件 materialization，可在对象存储凭据已配置的前提下直接复用同一条命令；不需要额外放大抓取范围。

目标：

- 只导出目标 `file_release_id` 对应的一条记录
- 确认 `pageFile -> getFile -> getFileUrl` 链路可用
- 确认 bundle / manifest 能成功落盘
- 如果对象存储已配置，确认目标 released file 可写入 source bucket

固定判定：

- manifest `filters.target_file_release_id` 必须等于目标 id
- manifest `run.items_inserted` 必须为 `1`
- bundle 首行的 `file_release_id` 必须等于目标 id
- 如果 collector 报 `target file_release_id <id> was not found in file_release
  export scope`，按 fail-close 处理，本轮不接受空成功产物

### 4. 可选的通用 bounded smoke

如果这次 auth window 只是验证 collector 链路，或者当前还没有 admission 具体 target，可继续使用最小数量 smoke：

```bash
AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS=1 \
pnpm --dir apps/authenticated-notice-collector file-release:export
```

可选再加 page 限制：

```bash
AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE=20 \
AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES=1 \
AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS=1 \
pnpm --dir apps/authenticated-notice-collector file-release:export
```

目标：

- 确认 `pageFile -> getFile -> getFileUrl` 链路可用
- 确认 bundle / manifest 能成功落盘
- 如果对象存储已配置，确认 released file 可写入 source bucket

### 5. 再做 full export

只有在明确需要 broader file-release inventory 时，才在 targeted export / bounded smoke
通过后继续 full export：

```bash
pnpm --dir apps/authenticated-notice-collector file-release:export
```

如需受控放量，可只设置以下 filter：

- `AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS`

固定规则：

- 已 admission 具体 target 时，默认停在 targeted export，不默认升级成 full export
- 只有明确需要 broader inventory 时，才从 targeted / smoke 升级到 full
- 不要在认证窗口里一边改代码一边试导出
- 不要在 full export 前跳过 `auth:check`

## 预期输出

默认输出目录：

- `apps/authenticated-notice-collector/runtime/exports/`

最少应看到：

- `file-releases-bundle-<timestamp>.json`
- `file-releases-manifest-<timestamp>.json`

命令 stdout summary 至少应包含：

- `bundlePath`
- `manifestPath`
- `bundleObjectKey` / `manifestObjectKey`；未配置对象存储时为 `null`
- `fileReleasesCollected`
- `fileObjectsUploaded`

如果当前执行的是 targeted export，还应看到 manifest 中：

- `export_scope=file-release-target-<file_release_id>-<timestamp>`
- `filters.target_file_release_id=<file_release_id>`

如果对象存储凭据齐全且源文件 materialization 成功，还应看到 manifest / bundle 中：

- `collector.file_storage_mode=object_store_write`
- `released_file.storage_provider=object_store`
- `released_file.object_key` 非空

如果对象存储未配置或当前只做引用捕获，则固定接受：

- `collector.file_storage_mode=reference_only`
- `released_file.storage_provider=reference_only`

## 建议保留证据

每轮 auth window 至少保留：

- 使用日期
- `auth:check` 输出
- targeted / smoke 产物文件名
- targeted / smoke 的目标 `file_release_id` 与 `items_inserted`
- 如果执行了 full export，再额外记录 full export 产物文件名与 item count
- 如果启用了 source bucket 上传，保留 object key 样例和 uploaded file count
- 如果启用了 run ledger，保留 `source_surface=file_release` 的 run id / row 摘要

建议本地证据目录：

- `.tmp/authenticated-notice-file-release/<timestamp>/`

## 失败时先看什么

1. `auth:check`
   - 如果 notice 成功但 `file_release` 失败，不继续导出
1. `file-releases-manifest-*.json`
   - 看 `run.pages_fetched`
   - 看 `run.items_seen`
   - 看 `run.items_inserted`
   - 看 `run.file_urls_resolved`
   - 看 `collector.file_storage_mode`
   - targeted export 时再看 `filters.target_file_release_id`
1. bundle 首行
   - 确认 `source_surface=file_release`
   - targeted export 时确认 `file_release_id` 与目标一致
   - 确认 `released_file` 是 `reference_only` 还是 `object_store`
1. source bucket
   - 若预期 materialized，但没有对象，直接视为本轮未完成 capture

## 固定禁止

- 不在本 runbook 里继续 `ingestion-worker` 命令
- 不在认证窗口里继续 replay / OCR / chunk / regulation 导入
- 不把 `file_release` 导出物直接当作 canonical `notice` source-truth
- 不因为一次失败就回退到手工拼 JSON 或手工下载散文件替代 repo export

## 完成判定

本 runbook 通过，只说明：

- 当前登录态可访问 `notice` 和 `file_release` 两个 authenticated surface
- collector 能产出 `file_release` bundle / manifest
- 如果对象存储可用，released file 源字节也被捕获

它不说明：

- downstream replay 已准备好
- regulation / internal_notice 消费可以立即继续
- OCR / chunk / index 质量已经验收
