# source-collector

内部门户 HTTP 适配器、文件发布 Temporal Activity 和本地通知采集命令。

## 所有权

本应用负责从原始 `SSO_TGC` 建立当前执行所需的门户会话，并提供三条独立入口：

- Temporal worker 按精确 ID 采集一份文件发布；
- 本地命令增量采集或按日期回填通知；
- `auth:check` 建立一次门户会话，`auth:keepalive` 在本地定期使用并检查当前 TGC；Kubernetes
  CronJob 在线上执行同一单次检查。

HTTP 会话、派生 Cookie、临时下载文件和供应商凭据只存在于本应用边界。应用不启动 workflow，
不维护 ingestion task 或 PostgreSQL 投影，不写 derived bucket，也不发布在线查询目标。

## 文件发布

ingestion-control 为每个精确文件发布 ID 启动一个 workflow，source-collector 只执行其中的采集
Activity。首次成功采集在 source bucket 写两个固定对象：

```text
internal_portal/<site-id>/file-releases/<file-release-id>/file
internal_portal/<site-id>/file-releases/<file-release-id>/source.json
```

`file` 是门户返回的原文件；`source.json` 是
`internal_portal_file_release_source.v1`，包含来源 metadata 和原文件引用。Activity 返回
`internal_portal_file_release_capture_result.v1`，其中只有该 ID 与 `source.json` 的摘要引用。
结果直接留在 Temporal workflow result，不另写 request、bundle、export、result manifest、
校验报告或离线发布对象。

对象写入采用 create-or-verify。已有合法 `source.json` 时直接返回同一引用，不再次请求门户。

## 通知

通知是本地开发命令，不进入 Temporal、任务注册表或 Ops API：

```bash
pnpm dev:init
pnpm --filter source-collector notice:sync
pnpm --filter source-collector notice:backfill -- --start-date 2026-01-01
pnpm --filter source-collector notice:status
```

`dev:init` 确保本地 MinIO 的 source bucket 存在，并生成该适配器使用的 `.env.local` 对象存储
配置；开发者自己的 `.env` 只保存当前门户与 TGC 配置。

来源固定为类型 `5`（办公通知），列表页大小固定为 20。首次 `notice:sync` 只记录当前最大 ID；
若当时没有通知，后续首次出现的通知会作为新增内容采集。历史采集必须显式提供日期。每个通知和
同步边界分别保存在：

```text
internal_portal/<site-id>/notices/<notice-id>.json
internal_portal/<site-id>/notices/_state.json
```

通知对象包含正文和附件 metadata，但不下载附件字节。通知命令不写 derived bucket 或其他
发布产物。

## 认证

本地命令通过 `INTERNAL_PORTAL_SSO_TGC` 提供原始 TGC。部署环境通过
`INTERNAL_PORTAL_SSO_TGC_FILE` 读取固定 Secret 的完整卷投影。`JSESSIONID`、`nginx` 和
Service Ticket 不跨执行保存。

```bash
pnpm --filter source-collector auth:check
pnpm --filter source-collector auth:keepalive
```

`auth:check` 只执行一次并以退出码表示结果。`auth:keepalive` 启动后立即检查，此后每 30 分钟
重新读取未跟踪的 `.env` 并检查；最近尝试时间、最近成功时间和结果分类写入同目录下忽略的
`.auth-status.json`，其中不包含 TGC。Kubernetes 每 30 分钟直接运行 `auth:check`。两种检查都不
请求通知或文件发布内容，不写对象存储，也不触发采集。

## Worker

```bash
pnpm --filter source-collector start:temporal-worker
```

worker 只轮询 `campus-agent.ingestion.activity.source-collector`，处理文件发布 Activity。生产使用
`infra/k8s/ingestion-runtime/base/runtime` 中的版本化 `WorkerDeployment`。

## 验证

```bash
pnpm --filter source-collector typecheck
pnpm --filter source-collector test:ingest
```
