# Agent Note: 候选复用与镜像清理边界

Status: implemented

## 背景

同一 Source SHA 的重复 push 曾再次发布制品并将成功候选改回 pending，干扰 GitOps 推进。
制品完整发布与 promotion 成功是两个不同阶段，只根据整个 run 的 conclusion 不能判断能否复用。
同时 PR 已只读 canonical cache，关闭时取消构建、等待和删除 PR cache 已失去当前写入消费者。
正式版本和部署 owner 已提供保留根，全量清理不再需要按普通 SHA 数量或年龄推测回滚用途。

## 决策

- Source 发布 owner 在写候选状态前读取同 workflow、仓库、main 和 SHA 的既有 jobs，选择发布、
  复用或跳过。完整发布后只补齐状态和 promotion；重复已处理的自动事件不写 pending。
  手动配置刷新保留显式重新发布，显式 recovery 验证原始 producer 和现有 artifact。
- 自动复用只使用当前计划需要的镜像和 Worker；显式 recovery 还保留指定发布 run 的全部 Worker
  候选，避免同 SHA 配置刷新被空源码 diff 丢弃。沿用现有 artifact，不新增意图清单或长期存储。
  recovery 的 run ID 与 Source SHA 必须在任何远端查询和候选状态写入前成对检查。
  失败的新发布可能覆盖同一次 run 的 artifact，因此
  不能用该 run 更早 attempt 的成功掩盖不完整发布。纯 recovery 重跑则继续查找原发布 attempt。
  artifact 过期时由维护者显式重新发布，不增加持久化去重表或长期候选包。
- 取消 PR-close 自动清理，移除 reusable workflow 的 PR cache 写入输入及 Actions 取消权限。
  历史 PR 缓存仍可按编号直查、校验关闭状态并删除，不扫描历史 PR 或恢复组织枚举。
- 候选发布、正式 Release 创建、full apply 共用 workflow 级 mutation 并发组，允许排队且不取消
  在途运行。去掉嵌套镜像 job 锁，避免持有同一锁的 workflow 等待自身子任务。
- full apply 复用 GitOps exporter 的正式版本、部署和恢复根，加上 canonical cache 和 OCI 子图。
  删除前刷新 GitOps refs、根和 inventory，只删除两次计划的交集；删除后验证目标消失及保护对象
  仍在。无法读取完整保留依据就失败，部分删除失败保留阶段诊断，重跑重新计算范围。
- GHCR retention 的 active package 注册表独立于 Source 镜像构建目标；GitOps 仍选择的通知采集、分类、
  索引和发布 Job 镜像也必须登记为 active。full workflow 使用具备组织 Packages 读取与删除权限的
  GitHub App token 读取 package inventory，GitOps token 继续只读环境仓和 deployments；两个身份不能
  互换。缺少登记包或 Packages 权限时在 report 阶段停止，不把 404 或空 inventory 当作可删除事实。
- 清理执行 owner 仍是 Source；GitOps 提供选择和保留事实。全量定时执行在真实 workflow token 的
  首次删除与复查通过后启用，不把报告或 fixture 成功当作删除验收。报告沿用短期 Actions artifact。

本篇部分取代[Source CI 缓存与镜像构建边界](./2026-09-24-source-ci-cache-and-build-boundaries.md)
中保留 `cache_write` 专用入口的决定；该篇 host build 去重、缓存 warning 与 GitOps 校验所有权仍有效。
同时取代[PR 缓存直查与暂停全量清理](./2026-09-17-ghcr-pr-cache-direct-cleanup.md)及
[原镜像保留与退役决策](./2026-09-04-ghcr-retention.md)中的 PR-close 自动协调和禁止 full apply；
已登记包直查、失败分类、retired allowlist 和 manifest 保护继续有效。正式版本身份与环境选择仍由
[正式版本与环境选择](./2026-10-02-formal-release-versioning.md)维护。

## 未采用方案

- **仅检查整体 run 成功**：无需解释 job 状态，但 promotion 失败会迫使已经完整发布的制品重建。
  选择已有 job 与 artifact 作为复用依据，不新增独立发布数据库。
- **保留未使用的 PR 导出和取消能力**：恢复旧策略方便，但没有现有调用者，持续保留权限和关闭
  触发成本；若以后重新出现明确写入消费者，再由同一 owner 设计写入与清理关系。
- **固定保留普通 SHA 七天**：实现简单，却把短期构建变成历史回滚承诺。使用正式版本和实际
  部署/恢复引用，不增加历史数量或时间窗口。
- **直接 apply 先前 report**：便于比对，但引用可能已前进；apply 重新读取事实，报告用于审阅，
  不能作为之后删除的授权快照。

## 后果

重复自动发布不会重新扰动候选状态；手动环境配置刷新仍可生成同 SHA 的新 Worker 版本。GitOps
对 pending 候选的既有拒绝规则保持有效，无需增加跨仓防御状态。`topology-required` 的处理仍由
环境拓扑 owner 负责，重复自动事件或显式 recovery 可复用候选再次推进，不把 Source job 成功解释为已经上线。

full apply 占用发布 mutation 队列，清理期间候选发布需要等待；这是保护 registry 写入与删除顺序的
直接代价。GitOps 仍可独立前进，删除前刷新并按交集缩小范围，不给普通已废弃 SHA 新增恢复承诺。
新环境、候选恢复入口或镜像写入 owner 出现时，要同步调整根或同一并发边界。
