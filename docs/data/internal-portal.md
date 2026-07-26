---
doc_type: data
owner_boundary: sources/internal-portal
status: active
---

# 内部门户来源数据

本页描述仓库中的离线采集目标合同。该运行时当前未部署，也没有 Ops Web 操作入口；文中的计划、
发布和 PostgreSQL 投影只有在重新启用所属 ingestion runtime 后才成为环境事实。

## 发布链路

内部门户数据通过来源级 Temporal 工作流发布到离线层：

```text
PostgreSQL 当前检查点
-> ingestion-control 写入不可变采集请求
-> source-collector 采集来源产物
-> TypeScript 确定性物化
-> 通知 document unit 校验
-> 有变化时写入对象存储完整发布清单
-> PostgreSQL 原子切换当前发布指针和检查点；无变化时只记录检查结果
```

同一次父工作流的采集、物化和校验任务共享一个 `run_id`。每个阶段返回
`ingestion_task_result.v1`，其 `result_ref` 指向带角色的严格 stage result。详细来源内容和
产物留在对象存储；PostgreSQL 只保存有界任务投影、发布流、当前发布指针和检查点。

## 通知

通知采集输入为 `internal_portal_notice_capture_request.v2`：

- `incremental` 使用 PostgreSQL 中每个通知类型的 `last_released_notice_id`；
- collector 必须找到上次头部，并继续采集 `overlap_pages` 指定的重叠页；
- 在安全页数内找不到上次头部时以 `checkpoint_gap` 结束，不更新发布指针或检查点；
- `reconcile` 读取所有启用类型和全部分页，以来源当前集合替换发布集合，并记录撤回条目；
- 通知计划在从未完整核对或距上次完整核对满 7 天时使用 `reconcile`；
- `reconcile` 不推进增量检查点，也不接受通知数量上限；
- `selected` 保留给明确 notice id/type 的受控采集。

采集阶段写入 source bundle、capture release 和
`internal_portal_notice_checkpoint.v1`。物化阶段写入来源事实、规范 Markdown 和 document
unit，并在 stage result 的 `items` 中明确每条通知及其版本。校验通过后，增量检查按 `item_id`
合并，完整核对用来源集合替换当前集合。排序后的条目、版本、产物摘要和检查点均未变化时，
工作流返回 `unchanged`，不创建 release 对象或数据库 release 行。

同源附件在采集时自动下载。正式物化只接受包含 bucket、对象 key、内容摘要和字节数的完整
对象引用，或明确的 HTTP 404/410 终态；临时失败、登录 HTML、可执行文件和仅引用记录均阻止
发布。单附件上限 50 MiB，单轮新增附件上限 1 GiB；外部图片只允许受信微信图片域名。

通知计划每 30 分钟执行一次，首次同步保持暂停。明确的 429/5xx 来源暂时故障在重试耗尽后
记为 `deferred`，计划继续；合同、代码、检查点和完整性失败会由 Temporal `pauseOnFailure`
暂停，只能人工恢复。凭据缺失或失效使用独立暂停原因；人员替换 TGC 后立即提交认证验证，
验证成功只恢复初始或凭据原因暂停，不恢复人工暂停和正确性失败暂停。

## 文件发布

文件发布输入为 `internal_portal_file_release_capture_request.v2`，只接受一个精确正整数 ID。
ingestion-control 为每个 ID 启动独立父工作流。采集结果必须
包含对象存储支撑的原文件；`reference_only` 记录不能发布成功。

文件发布没有自动计划，也没有范围扫描。并发 ID 在提交时重新读取最新完整发布清单，按
`item_id` 合并后原子更新同一个文件发布流。

## 存储合同

- source bucket：采集请求、provider/export bundle、原文件、capture release 和采集结果；
- derived bucket：来源事实、规范文档单元、校验结果和 `ingestion_offline_release.v1`；
- `ingestion_control.tasks`：阶段任务状态和有界错误；
- `ingestion_control.offline_release_streams`：当前发布指针、检查点、乐观版本、最近检查/完整核对/
  发布状态及新增、更新、撤回数量；
- `ingestion_control.offline_releases`：不可变发布记录及其清单引用。

发布止于可供未来下游读取的离线完整清单。它不创建 chunk、Qdrant collection、alias、在线
query target、产品通知页或规章记录；`internal_notice` 仍不在 query-serving target registry。

固定认证保活只验证 TGC，不作为采集准入条件。每个采集 activity 必须能从挂载 TGC 独立建立
会话，本地 storage state 不是跨 Pod 状态。

两只 MinIO bucket 启用版本控制，业务身份没有 `DeleteObject`。顶层 `attempts/`、
`ingestion-results/` 和 `ingestion-requests/` 是 30 天临时前缀；内容寻址来源事实与 release 历史
长期保留。

## 相关文档

- `docs/architecture/system/data-plane.md`
- `apps/ingestion-control/openapi.yaml`
- `docs/contracts/file-release-export.md`
- `docs/runbooks/portal-auth.md`
