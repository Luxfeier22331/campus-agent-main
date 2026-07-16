---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0052
status: accepted
---
# ADR-0052 Qdrant 托管方式

## 背景

早期方案假设使用 Qdrant Cloud 和对象存储快照包，项目实际运行的是私有自托管 Qdrant。
容量、主机剩余空间和特定日期集合数量属于部署
证据，不是架构决策。

## 决策

Qdrant 自托管且不公开。除非 availability requirement 证明需要经过独立评审的 distributed
deployment，否则保持 single-node。

- 在线执行使用 read-only query credential。
- admin credential 仅供 ingestion、lifecycle、backup 和 restore。
- 服务不直接暴露到 public internet。
- runtime storage、TLS、key 和 topology 属于 environment repo；local Compose 只用于开发。

恢复使用 Qdrant 原生 collection snapshot。snapshot 不进入 ingestion source/derived
bucket。可恢复 backup 必须包含 snapshot、release/alias metadata、off-host copy 和经测试的
restore procedure；挂载 snapshot directory 或创建文件本身不构成恢复证据。

backup frequency 和 retention 属于环境策略，本 ADR 不固定。所属环境无法提供证据时，
仓库不得宣称自动 backup、off-host replication 或 restore 已就绪。

## 后果

- Qdrant 是可以从已开放上游事实重建的 index，不是 document source。
- single-node 不具备 high-availability 声明。
- alias recovery 使用 release metadata，不能假设 collection snapshot 包含 alias truth。
- 可执行 release/retention lifecycle 出现前，不允许 collection deletion。

## 外部参考

- <https://qdrant.tech/documentation/concepts/snapshots/>
- <https://qdrant.tech/documentation/guides/security/>
