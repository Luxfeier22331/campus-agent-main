# internal-portal-collection

内部门户通知与文件发布的一次性采集任务。通知模式写入 source 对象并登记 `notices.*` 库存；文件发布
模式只写 source 对象。该包不持久化 TGC，不负责通知分类、发布、PDF 解析、常驻服务或自动调度。

## 入口

- `adapters/internal-portal/src/collection-cli.ts`：读取本地托管环境并执行显式采集动作；
- `adapters/internal-portal/src/collection-job.ts`：供 Kubernetes Job 解析 Ops Web 凭据后执行同一采集实现；
- `adapters/internal-portal/src/auth-cli.ts`：本地凭据拉取与认证检查。

采集和 `state-versions` 共用 source 对象存储配置：`OBJECT_STORE_ENDPOINT`、
`OBJECT_STORE_BUCKET_SOURCE`、`OBJECT_STORE_SOURCE_ACCESS_KEY`、`OBJECT_STORE_SOURCE_SECRET_KEY`
均必填。bucket 不提供代码默认值；本地由 `dev:init` 写入当前 worktree 配置，集群由 Job 模板显式提供。
版本检查、备份、删除和 CLI 输出均使用该配置中的实际 bucket。

## 相关文档

- 操作步骤与故障排查：`docs/runbooks/ingestion/ingestion.md`
- TGC 管理：`docs/runbooks/access/portal-auth.md`
- 数据布局：`docs/data/internal-portal.md`、`docs/data/notices.md`
- 文件发布合同：`docs/contracts/internal-portal-file-release.md`
