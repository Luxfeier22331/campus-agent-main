---
doc_type: reference
owner_boundary: docs/postmortem
status: active
---

# staging PostgreSQL 与通知流水线恢复

## 摘要

2026-09-29 排查发现数据库实际 TLS 证书偏离现有客户端合同，GitOps PostgreSQL base 引用无效 SHA，
副本复制与备份归档缺少网络通路。恢复原有证书并补齐依赖后，服务 Ready，备份成功，副本重建成功。
通知链路同时存在已删除 CronJob 的残余调用和两个缺失网络方向。源码静态检查未覆盖这些组合行为。

## 影响

Execution Control、Model Config、Ops Web 曾不能按现有 CA 验证数据库连接；数据库仅主库可用，
WAL 归档失败。通知维护入口无法从已删除模板创建任务，完整采集与检索链路尚需部署修复后验收。
未据此推断全部公网请求失败或数据丢失。

## 经过

- 对比上次健康 Source `8587749` 与备份改动，确认新增备份和副本是预期目的，没有 TLS 迁移目的。
- GitOps `b24c585` 引入错误 base SHA，后续 `7cfd1c3` 合并保留错误引用并回退发布元数据。
- 暂停四个相关 Application 自动同步并终止卡住的操作，避免错误 revision 覆盖恢复。
- 2026-09-29 05:46（上海时间）恢复既有服务端证书配置，三个服务随后 Ready。
- 05:49 基础备份完成；保留失败副本 PV 后重建，两个实例 Ready 且复制 streaming。
- 05:54 独立 Cluster 从基础备份和命名恢复点启动，读到 7,241 条通知和原索引指针，随后清理演练资源。

## 根因

实际 Cluster 未使用 GitOps 已声明的 origin server certificate；造成该漂移的操作者尚未确定。
副本与归档网络未随备份拓扑补齐，ObjectStore retention 层级错误，资源依赖未在 Cluster 前就绪。
通知迁移删除了 CronJob，却留下维护接口与兼容任务展示的模板读取；republish mode 也仍调用普通发布。

## 为什么检查没发现

Ready、静态清单和单包测试分别通过不能证明数据库 CA、跨仓不可变引用和真实调用链一致。
既有 Temporal 集成测试沿用单队列 RAG 假设，不能证明拆分后完整通知流水线。

## 修复与回归验证

已执行数据库证书恢复、备份、副本重建和隔离恢复；原失败 PV 保持 Retain。
源码修复由[网络与备份回归测试](../../infra/k8s/tests/cluster-recovery.test.ts)、
[通知运行投影测试](../../apps/ops-web/test/temporal-notice-jobs.node.test.ts)和
[流水线行为测试](../../apps/notice-pipeline-worker/test/workflows.test.ts)覆盖。
GitOps 收敛、修复镜像上线、手动全链路与两轮定时验收仍待执行，完成后更新本节。

## 长期教训

备份能力以成功归档和独立恢复结果为准；同节点副本和同节点对象存储不代表节点级容灾。
接口迁移必须沿实际调用入口验证，不以删除旧 workload 作为迁移完成。
长期选择见[备份决策](../../.agents/notes/implemented/architecture/2026-09-28-cnpg-backup-plugin.md)与
[通知流水线决策](../../.agents/notes/implemented/architecture/2026-09-20-notice-pipeline-unification.md)，
操作步骤见[数据恢复](../runbooks/data-recovery.md)。
