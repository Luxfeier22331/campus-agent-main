---
doc_type: runbook
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Authenticated Notice File-Release Auth-Window Runbook

## 文档边界

这份 runbook 只描述一件事：

- 当拿到新的 `SSO_TGC` 后，如何在认证窗口内先做 `file_release` 预检，再做 bounded export / full export

它不替代：

- `docs/reference/authenticated-notice-file-release-export-contract.md` 的导出契约
- `docs/runbooks/authenticated-notice-bootstrap-smoke-runbook.md` 的 notice bootstrap import smoke
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md` 的 replay / preparation 路径

## 适用范围

当前 runbook 只适用于：

- `authenticated_notice_portal/file_release`
- collector side capture / export
- next auth window 的 smoke + full export

当前明确不做：

- ingestion-worker replay
- regulation promotion
- OCR
- chunk preparation
- Qdrant / embedding
- release / alias publish

## 前置条件

- 已有新的 `SSO_TGC`
- root `.env` 或 collector 环境中已配置必要对象存储凭据时，允许源文件 materialization
- 当前从 repo root 执行命令

建议先确认 collector 环境已落盘：

- `AUTHENTICATED_NOTICE_RUNTIME_DIR`
- `AUTHENTICATED_NOTICE_SOURCE_HOME_URL`
- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OBJECT_STORE_BUCKET_SOURCE`

说明：

- `SSO_TGC` 是 operator 需要主动更新的主字段
- `JSESSIONID` / `nginx` 由 portal runtime 访问派生，不应作为主要人工维护输入

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

### 3. 先做 bounded smoke

拿到通过的预检后，先做一个最小 bounded export：

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

### 4. 再做 full export

bounded smoke 通过后，再执行 full export：

```bash
pnpm --dir apps/authenticated-notice-collector file-release:export
```

如需受控放量，可只设置以下 filter：

- `AUTHENTICATED_NOTICE_FILE_RELEASE_PAGE_SIZE`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_PAGES`
- `AUTHENTICATED_NOTICE_FILE_RELEASE_MAX_ITEMS`

固定规则：

- 先 smoke，再 full
- 不要在认证窗口里一边改代码一边试导出
- 不要在 full export 前跳过 `auth:check`

## 预期输出

默认输出目录：

- `apps/authenticated-notice-collector/runtime/exports/`

最少应看到：

- `file-releases-bundle-<timestamp>.json`
- `file-releases-manifest-<timestamp>.json`

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
- smoke 产物文件名
- full export 产物文件名
- full export item count
- 如果启用了 source bucket 上传，保留 object key 样例和 uploaded file count

建议本地证据目录：

- `.tmp/authenticated-notice-file-release/<timestamp>/`

## 失败时先看什么

1. `auth:check`
   - 如果 notice 成功但 `file_release` 失败，不继续导出
2. `file-releases-manifest-*.json`
   - 看 `run.pages_fetched`
   - 看 `run.items_seen`
   - 看 `run.items_inserted`
   - 看 `run.file_urls_resolved`
   - 看 `collector.file_storage_mode`
3. bundle 首行
   - 确认 `source_surface=file_release`
   - 确认 `released_file` 是 `reference_only` 还是 `object_store`
4. source bucket
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
