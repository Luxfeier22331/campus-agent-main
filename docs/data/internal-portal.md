---
doc_type: data
owner_boundary: sources/internal-portal
status: active
---

# 内部门户数据

## 凭据池

内部门户数据包含 Ops Web 所有的认证凭据，以及 internal-portal-collection 产生的来源对象。
凭据进入 PostgreSQL，来源对象只写 source bucket；两类数据不互相复制。通知来源与规范化投影由
[通知数据](./notices.md) 维护。来源采集不会创建 Campus Web reader、derived 产物或 Campus Docs
索引，也不替换当前索引绑定。

Ops Web 使用 `internal_portal.credentials` 保存多条具名记录。每条记录包含
`credential_id`、唯一名称、原始 `sso_tgc`、单调版本、创建和更新时间，以及最近尝试、最近成功与
`valid`、`credential_rejected`、`check_failed` 三种结果。表不保存主凭据、用途、软删除或当前选中项。

新增和轮换先完成真实 CAS 验证，失败不写候选值。CAS 返回刷新值时保存新 TGC。重命名、轮换、删除、
人工检查和定时检查都使用当前版本，旧检查不能覆盖并发修改。解析时跳过
`credential_rejected`，按 `valid`、未检查、`check_failed` 依次验证，返回第一条可用记录；名称不会
暴露给采集器。

Ops Web 列表只显示 metadata，人工 reveal 通过同一服务的独立 `POST`。明文只进入当前对话框 state。
`ops_web` 是凭据表唯一运行角色；App API 和 internal-portal-collection 都无数据库权限。

## 自动化 token

Ops Web 继续使用 `internal_portal.automation_tokens` 保存具名机器 token。明文用于人工重复 reveal，
SHA-256 hash 用于 Bearer 查询；普通列表只返回 metadata。有效 token 可以通过 Ops Web automation
endpoint 创建、读取 metadata、轮换或删除任一凭据，TGC 操作由 Ops Web 直接执行。

`ops_web` 是 automation token 表和凭据表的唯一运行角色。该 token 不参与采集消费；
internal-portal-collection Job 使用既有 `OPS_WEB_INTERNAL_TOKEN` 调用 Ops Web 内部解析接口。

## 文件发布来源

internal-portal-collection 为每个文件发布 ID 写入：

```text
internal_portal/<site-id>/file-releases/<file-release-id>/file
internal_portal/<site-id>/file-releases/<file-release-id>/source.json
```

`file` 是原始下载字节。`source.json` 使用 `internal_portal_file_release_source.v1`，保存门户 metadata、
文件名、media type、字节数、摘要和对象 key。已有合法 `source.json` 时不再访问门户。同 key 内容冲突
明确失败。

当前不保存 workflow result，不解析 PDF，不执行 OCR、清洗、分类或发布。

## 来源对象生命周期

`internal-portal-collection` 是门户 source 对象的生产者，来源数据面拥有以下对象：原始 `file`、对应
的 `source.json` 以及仍被来源清单或后续规范化流程引用的历史版本。采集 Job 不负责删除对象，也不对
Campus Docs 的 normalized reader、chunk、embedding 或 Qdrant collection 负责。清理前必须由来源 owner
依据完整 reader/补充资产引用重新计算存活 key 集合，并按[Campus Docs runbook](../runbooks/campus-docs.md)
中的核对步骤执行；本合同不引入宽泛 TTL 或自动回收任务。

## 认证生命周期

Service Ticket、`JSESSIONID` 和 `nginx` Cookie 只存在于当前 HTTP 会话。采集器建立业务会话时得到的新
TGC 只在本次会话使用，不回写凭据池。本地 `internal-portal:auth:pull` 把解析结果写入受管理的
`.env.local`；集群 Job 只在进程内使用响应，不创建 TGC Secret。

## 相关文档

- [内部门户文件发布采集](../contracts/internal-portal-file-release.md)
- [内部门户认证](../runbooks/portal-auth.md)
- [internal-portal-collection](../../jobs/internal-portal-collection/README.md)
