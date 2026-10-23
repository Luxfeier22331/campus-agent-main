# Agent Note: Agent Control 迁移的运行时权限与维护 Job 生命周期

Status: implemented

## 背景

Agent Control schema 重命名已经完成 DDL 和表级授权，但运行时身份 `agent_control` 没有数据库级 `CONNECT`。迁移集成测试只使用 `campus_agent` owner 连接，并且没有模拟收紧后的 `PUBLIC` ACL，因此 staging 的 verify Job 才首次暴露该缺口。同一批次只修了 `agent_control`，其它消费者的 `CONNECT` 仍只来自历史 `PUBLIC` 默认或手工操作：仓库里只有 `product_data_ro` 和 `campus_search` 两条迁移携带显式授权，从零安装会漏掉 `app_api`、`model_config`、`ops_web`。

维护阶段的固定名称 Job 在成功后留在集群中，下一阶段从 overlay 移除旧 Job 时会让 Argo CD Application 保持 `OutOfSync`，阻塞 Kargo 的 `argocd-wait`。

staging 恢复又暴露维护计划的两个缺口：维护计划在 prepare 阶段冻结候选的 schema 镜像，之后各阶段复用该镜像，修复合并前生成的计划不会自动升级；并且 verify 阶段只同步 `maintenance-staging`，不包含 `data-postgres-staging`，因此新镜像不会自动应用。verify Job 用早于候选的镜像运行时，`compareHistory` 会因 ledger 里多出未知迁移而失败。

## 决策

- 库级 `CONNECT` 收敛到统一迁移：新增迁移为全部 `campus_agent` 消费者显式 `GRANT CONNECT`，`agent_control` 专用迁移保持原文本不可变，因为已应用的 migration SQL 按 hash 校验。
- migration 集成测试撤销测试数据库的 `PUBLIC CONNECT`，并为每个消费者建独立 login 角色，逐一建立真实连接；从零安装缺授权时连接必须以 `42501` 失败，再跑补齐迁移的连接必须成功。
- 新增静态一致性测试比对 `DatabaseRole` 角色名、所有权文档消费者表和迁移 `GRANT CONNECT` 目标，缺一即失败；本地开发路径不再为产品角色补授权，只保留本地独有的 `notice_publisher`。
- maintenance verify 使用 runtime URL 建立真实连接，并检查 database `CONNECT` 和运行时表查询。
- maintenance verify 保留 main 的 `campus_docs_serving.index_versions` 表访问合同；未合并的检索重构不属于本次修复。
- 维护 Job 使用 `PostSync` hook，并在成功后用 `BeforeHookCreation,HookSucceeded` 清理，避免完成资源影响后续 Argo 同步。

## 未采用方案

- 不通过集群手工 `GRANT` 修复，因为这会绕过 migration ledger 和发布流程。
- 不只增加 SQL 文本正则测试，因为它不能证明真实身份可以建立新连接。
- 不扩写已发布的 `20261016110000_agent_control_connect`，因为任何环境应用后修改其 SQL 都会触发 ledger hash 校验失败。
- 不把已完成 Job 标记为 ignored 或跳过 Argo 健康检查；成功 Job 应由 hook 生命周期清理，失败 Job 仍需暴露。

## 后果

权限合同、runtime 身份和维护资源生命周期都由可重复的 migration、GitOps 生成器和集成测试覆盖。后续新增数据库消费者时，必须在同一迁移批次补显式 `CONNECT`，静态与集成测试会同时覆盖“角色是否被授权”和“真实身份能否连接”。

维护计划在 prepare 阶段冻结候选镜像这条约束仍然存在：修复合并前生成的计划不会自动切换镜像，verify 阶段也不会同步 `data-postgres-staging`。因此恢复 staging 需要显式升级 data-postgres overlay 的 schema 镜像并先同步该 Application，再对同一 Freight 新建 Promotion；阶段 PR 一旦合并也无法用同一 profile 重跑。
