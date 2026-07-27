---
doc_type: data
owner_boundary: sources/internal-portal
status: active
---

# 内部门户来源数据

## 边界

内部门户目前产生通知来源对象和文件发布来源对象。两者都只写 source bucket，不创建规范文档、
derived 产物、离线发布清单、知识索引、产品通知页或模型查询目标。门户内容不按登录主体变化，
对象身份只包含站点与来源 ID。

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

source-collector 从当前原始 TGC 建立内存会话。Service Ticket、`JSESSIONID` 和 `nginx` Cookie
不写环境变量、对象存储、PostgreSQL 或 Temporal 载荷。Kubernetes CronJob 定期运行
`auth:check`，只建立会话并以退出码表示结果，不触发通知或文件发布采集。

## 相关文档

- `docs/contracts/internal-portal-file-release.md`
- `docs/runbooks/portal-auth.md`
- `apps/source-collector/README.md`
