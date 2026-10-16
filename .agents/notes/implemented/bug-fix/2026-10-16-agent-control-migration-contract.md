# Agent Note: Agent Control 迁移的运行时权限与维护 Job 生命周期

Status: implemented

## 背景

Agent Control schema 重命名已经完成 DDL 和表级授权，但运行时身份 `agent_control` 没有数据库级 `CONNECT`。迁移集成测试只使用 `campus_agent` owner 连接，并且没有模拟收紧后的 `PUBLIC` ACL，因此 staging 的 verify Job 才首次暴露该缺口。

维护阶段的固定名称 Job 在成功后留在集群中，下一阶段从 overlay 移除旧 Job 时会让 Argo CD Application 保持 `OutOfSync`，阻塞 Kargo 的 `argocd-wait`。

## 决策

- 通过独立 migration 显式授予 `agent_control` 对当前数据库的 `CONNECT`；不修改已经发布的 migration SQL。
- migration 集成测试撤销测试数据库的 `PUBLIC CONNECT`，并使用独立 `agent_control` login 建立真实连接，验证运行时表访问。
- maintenance verify 使用 runtime URL 建立真实连接，并检查 database `CONNECT` 和运行时表查询。
- maintenance verify 保留 main 的 `campus_docs_serving.index_versions` 表访问合同；未合并的检索重构不属于本次修复。
- 维护 Job 使用 `PostSync` hook，并在成功后用 `BeforeHookCreation,HookSucceeded` 清理，避免完成资源影响后续 Argo 同步。

## 未采用方案

- 不通过集群手工 `GRANT` 修复，因为这会绕过 migration ledger 和发布流程。
- 不只增加 SQL 文本正则测试，因为它不能证明真实身份可以建立新连接。
- 不把已完成 Job 标记为 ignored 或跳过 Argo 健康检查；成功 Job 应由 hook 生命周期清理，失败 Job 仍需暴露。

## 后果

权限合同、runtime 身份和维护资源生命周期都由可重复的 migration、GitOps 生成器和集成测试覆盖。后续新增数据库消费者时，必须同时补充显式 `CONNECT`、真实连接测试和维护验收路径。
