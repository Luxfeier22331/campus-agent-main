# Agent Note: campus_agent 共享库连接授权模型

Status: implemented

## 背景

`campus_agent` 是共享产品数据库：`app_api`、`execution_control`、`model_config`、`ops_web`
等多个运行角色连接同一库，角色与消费关系由
[PostgreSQL 所有权](../../../../docs/data/postgres-ownership.md)维护。PostgreSQL 默认给每个库的
`PUBLIC` 授予 `CONNECT`，所有登录角色因此隐式获得连接能力，静态 ACL 上看不到逐角色授权。

一次库级权限变更暴露出：不能仅以 ACL 推断消费者，也不能用进程存活检查替代新连接验证。
共享运行时在连接池回收后失去连接，随后按真实消费者逐一恢复显式授权。根因不是授权模型本身，
而是把"无显式授权"当成"非消费者"，并用与故障模式不匹配的检查收尾。本笔记只保留由此确立的
授权模型与变更约束，事故经过由事故复盘负责。

## 决策

- 数据库级 `CONNECT` 不依赖 `PUBLIC` 默认授权：`campus_agent` 库对 `PUBLIC` 仅保留
  `TEMP`，连接能力只来自对真实消费者的显式 `GRANT CONNECT`。
- 消费者清单的当前事实由 [PostgreSQL 所有权](../../../../docs/data/postgres-ownership.md)拥有；本笔记
  只持有理由和约束，不复制清单。
- 新增连接 `campus_agent` 的运行角色时，环境实施必须同步补 `CONNECT` 授权，否则该角色
  无法建立任何连接。
- 协作者只读角色（如 `hindsight_ro`）不通过收紧 `PUBLIC` 实现跨库隔离；跨库边界由
  schema 与表级不授权承载，`CONNECT` 本身不授予任何读能力。
- 修改任何库级权限前必须先核对真实消费者：`pg_stat_activity` 的现存连接加所有权文档
  角色表，二者都确认后才执行；验证以每个消费者新建连接成功为准。

## 未采用方案

- **收回 `PUBLIC` 的 `TEMP` 授权**：跨库隔离由 schema 与表级不授权承载，`TEMP` 不授予读能力，
  收紧它不影响协作者可见边界，只增加共享库工作表的运维摩擦。
- **按角色拆分独立数据库**：消除了库级授权耦合，但迁移成本与消费者清单重建远超本次事故
  暴露的流程缺口，作为重新评估条件记录而非当前方案。
- **依赖 pod 存活与 ACL 推断做变更验收**：与故障模式不匹配，事故已证明存量连接掩盖权限
  缺失，验收必须以每个消费者新建连接成功为准。

## 信任边界与失败处理

存量连接不受 `CONNECT` 收回影响，故障会随各服务连接池回收延迟暴露，pod 存活不构成权限
变更安全的证据。"角色没有显式授权"不能推出"角色不消费该库"：`PUBLIC` 默认授权时期建立的
消费关系全部依赖隐式路径。缺乏消费者核对时，宁可不收紧也不猜测清单。

## 后果

连接能力改为显式 `GRANT CONNECT` 后，新增运行角色若未同步授权将无法建立任何连接，环境实施
需要把授权纳入变更清单。修改库级权限前的消费者核对成为强制步骤，验收标准从配置推断改为真实
连接验证。具体操作见[协作者只读访问 runbook](../../../../docs/runbooks/access/collaborator-access.md)，
本笔记保留授权模型与变更约束。

## 重新评估与删除条件

出现以下情况时重新评估本模型：`campus_agent` 按角色拆分为独立数据库，PostgreSQL 提供
可用的 per-role 数据库级 DENY，或所有权文档将数据库级授权并入统一 schema 安装 Job 声明。
届时显式 `CONNECT` 清单可随迁移脚本收敛，`PUBLIC` 收紧本身不需回退。

## 相关文档

- [PostgreSQL 所有权](../../../../docs/data/postgres-ownership.md)
- [协作者只读访问](../../../../docs/runbooks/access/collaborator-access.md)
