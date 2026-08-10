---
doc_type: data
owner_boundary: sources/internal-portal
status: active
---

# 内部门户数据

## 边界

内部门户数据包含 Ops Web 所有的认证凭据，以及 source-collector 产生的通知和文件发布来源对象。
凭据进入 PostgreSQL，来源对象只写 source bucket；两类数据不互相复制。来源采集不创建规范文档、
derived 产物、离线发布清单、知识索引、产品通知页或模型查询目标。门户内容不按登录主体变化，
对象身份只包含站点与来源 ID。

## 认证凭据

Ops Web 使用 `internal_portal.credentials` 保存多条具名记录。每条记录包含随机 `credential_id`、
唯一名称、原始 `sso_tgc`、单调递增版本、创建与更新时间，以及最近尝试、最近成功和结果分类。结果为
`valid`、`credential_rejected` 或 `check_failed`；`null` 只表示尚未检查。表不维护主凭据、用途、
自动切换、fingerprint、末四位、软删除、审计实体或运行时选择状态。

新增和轮换先完成真实 CAS 验证，失败不写入候选值。CAS 返回刷新的 TGC 时保存新值。重命名、轮换、
删除和定时检查都以当前版本为并发前置条件，旧检查不能覆盖检查期间发生的轮换。

定时检查每 30 分钟读取一次记录。`credential_rejected` 记录不再自动访问门户，轮换或人工检查成功
并写回 `valid` 后恢复；`check_failed` 记录在下一周期继续检查。暂停状态直接由现有
`last_outcome` 推导，不增加持久化字段。检查接受 CAS 可能返回的当前 TGC，但不保证延长其生命周期。

Ops Web 列表只投影非敏感 metadata。明文读取是单独的同源 `POST`，TGC 只进入当前浏览器对话框
内存，不进入查询缓存或浏览器存储。`ops_web` 是该 schema 的唯一运行角色；App API、
source-collector、Temporal 和对象存储都不能读取该表。

记录随 PostgreSQL 正常持久化，Pod 重启和滚动部署不会删除；清空或重建所属数据库后不从 GitOps、
Secret 或其他存储恢复，必须重新录入。

## 自动化 token

`internal_portal.automation_tokens` 保存多条具名机器访问 token：`token_id`、`name`、
`token_value`、`token_hash`、`created_at` 和可空 `revoked_at`。`token_value` 明文是当前合同的一部分，
因为操作者需要在 Ops Web 中重复查看并交给开发者程序；`token_hash` 只用于 Bearer 认证查询。普通
列表 SQL 和 HTTP 响应只读取 metadata，创建或人工 reveal 才读取明文。

一个未撤销 token 默认可以操作全部 `internal_portal.credentials` 记录。当前没有 token scope、按人
员授权、过期时间或独立角色；新增这些区分前必须先有明确消费者和合同。撤销设置 `revoked_at`，使
后续认证失败，但保留记录供人工识别和再次 reveal。`ops_web` 是该表唯一运行角色；App API、
source-collector、Temporal 和对象存储不能读取 token 表。

## 通知

通知由 `apps/source-collector` 本地命令直接采集，不进入 Temporal、任务注册表、PostgreSQL 或
Ops API。来源固定为类型 `5`（办公通知），页大小固定为 20。

每个通知保存为一个 `internal_portal_notice_source.v1` 对象：

```text
internal_portal/<site-id>/notices/<notice-id>.json
```

对象保存标题、组织、发布时间、正文、链接和附件 metadata。附件只保留门户提供的标识、名称、
路径和类型，保持门户返回顺序与重复记录，不下载附件字节。重跑遇到已有 ID 时重新取得详情；只有
内容完全一致才复用已有对象，内容变化或已有对象损坏时明确失败且不覆盖。

同步边界保存在同一前缀：

```text
internal_portal/<site-id>/notices/_state.json
```

该对象使用 `internal_portal_notice_sync_state.v1`，记录 `incremental_head_id`、实际采集到的最小和
最大 ID、`history_covered_from` 以及更新时间。首次 `notice:sync` 只观察第一页并建立 head，不
保存部署前通知；若当时列表为空，后续首次出现的通知作为新增内容采集。后续同步按总条数分页，
验证 ID 严格递减并准确扫描到旧 head 后，只处理 head 之前的新 ID。历史通知必须显式执行：

```bash
pnpm --filter source-collector notice:backfill -- --start-date 2026-01-01
```

只有完整扫描成功后才更新历史覆盖日期。`notice:status` 直接读取 `_state.json` 展示边界。同一
`site_id` 的 sync 与 backfill 必须串行执行，由单一命令写入该状态对象。

## 文件发布

文件发布由 ingestion-control 的获准内部接口接收精确正整数 ID。当前 Ops Web 不提供提交或状态
页面。ingestion-control 为每个 ID 启动一个独立 Temporal workflow，source-collector Activity 写入：

```text
internal_portal/<site-id>/file-releases/<file-release-id>/file
internal_portal/<site-id>/file-releases/<file-release-id>/source.json
```

`file` 是原始下载字节。`source.json` 使用 `internal_portal_file_release_source.v1`，保存门户
metadata、文件名、media type、字节数、摘要和 `file` 的对象 key。Activity 返回
`internal_portal_file_release_capture_result.v1`，只引用 `source.json`；该结果留在 Temporal
workflow result，不另存对象。

同一 ID 的第一次成功采集确定这两个固定对象。已有合法 `source.json` 时直接返回，不访问门户；
首次写入中的同 key 字节冲突会明确失败。

## 认证

共享内部门户客户端使用当前原始 TGC 建立内存会话。Service Ticket、`JSESSIONID` 和 `nginx`
Cookie 不写环境变量、对象存储、PostgreSQL 或 Temporal 载荷。Ops Web 只持久化 CAS 返回的当前
TGC 和有界检查 metadata；source-collector 的本地 `auth:check` 不写认证状态。

Ops Web CronJob 直接读取凭据表并顺序检查未暂停记录，不经过 source-collector，不写 source 或
derived bucket，也不触发通知或文件发布采集。source-collector 本地命令只消费开发者显式传入的
直接变量，不持久化该值或读取凭据表。开发者可以从 Ops Web 获取自动化 endpoint 和 Bearer token，
由自己的程序显式调用机器接口；这仍不是 source-collector 的隐式数据库消费路径。

## 相关文档

- `docs/contracts/internal-portal-file-release.md`
- `docs/runbooks/portal-auth.md`
- `apps/source-collector/README.md`
