---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0029
status: accepted
created: 2026-04-05
updated: 2026-04-19
---
# ADR-0029 IPv4 Operator Session-Pooler Postgres Connectivity

适用范围：repo-owned persistent runtime 的 Postgres 连接策略、Supabase-backed
registry/control-plane database、authenticated notice / ingestion-worker / app
runtime 的长期 IPv4 部署姿态

## 背景

当前 repo 的长期 data-plane 语义已经冻结为：

- 对象文件与 source/document artifacts 进入 `S3-compatible object storage`
- Postgres 只承载 registry、control-plane、run/progress truth 与其他关系型 metadata

这条边界已经在 supporting architecture 中成立，但当前 repo 仍存在两类实际问题：

- 运行环境是否具备稳定 IPv6 并不确定；继续围绕 `direct connection` / `session pooler` 做 runtime
  自动切换会把部署面复杂度提前引入 repo
- Python ingestion / closeout 路径仍大量采用按操作建立连接的模式，在 worker 并发拉高时会放大 session 建立、释放和
  pooler 往返成本

因此 repo 需要为“长期按 IPv4 运行、不增加不必要复杂度”的前提冻结一条单主线连接策略。

## 决策 1：对象存储与 Postgres 责任保持长期分离

固定规则：

- `S3-compatible object storage` 持有 raw/source/document artifact bytes
- Postgres 只持有 registry、authorization/filter metadata、closeout staging
  truth、operator/control-plane truth
- 不把对象 bytes 迁入 Supabase Storage 作为 repo 级长期默认形态
- 不把 Postgres 当作 document/source artifact 的 blob 存储

这条决策补充 data-plane 边界，不改变 `raw -> source truth -> document -> chunk/index` 的
canonical chain。

## 决策 2：repo-owned persistent runtime 的网络姿态固定为 IPv4-only

固定规则：

- repo-owned persistent runtime 默认按 `IPv4-only` 部署处理
- runtime 不做 IPv6 探测，也不在 `direct connection` 与 `session pooler` 之间自动切换
- env template、runbook、worker/operator 命令默认都围绕 IPv4 可达性设计

如果未来某条部署基线要改为“显式保证 IPv6、并统一走 direct connection”，那必须作为新的独立决策收口，而不是在当前 runtime
内做双路径兼容。

## 决策 3：运行时 Postgres 主连接固定为 Supabase session pooler

当共享 Postgres 由 Supabase 承载时，repo-owned runtime traffic 固定规则为：

- 长驻 app / worker / ingestion runtime 使用 Supabase `session pooler`
- `direct connection` 不作为 repo runtime 默认主链路
- `transaction pooler` 只保留给未来真正的短命 / serverless / edge SQL client，不作为长驻 worker
  主链路

这意味着：

- `CAMPUS_SHARED_POSTGRES_URL` 的长期语义是 runtime-ready shared DSN
- canonical operator env 命名使用 `*_OPERATOR_*`，并统一指向 IPv4 可达的 session pooler
  `:5432`
- 现存 `*_MANAGEMENT_*` env 名称不再作为 runtime env path，也不代表 repo-level
  direct/default posture
- 在当前 IPv4-only 姿态下，它应指向 session pooler，而不是 `db.<project-ref>.supabase.co`
- 未来如果重新开放 explicit `direct/IPv6` lane，应通过新的显式 tool /
  决策收口，而不是继续复用默认 operator env

## 决策 4：所有长驻 runtime 必须使用 application-side pooling

固定规则：

- 长驻 Python / Node runtime 必须在进程内复用数据库连接
- 不允许把“每次数据库操作新建一个连接”作为长期 canonical 运行形态
- session pooler 负责 server-side 连接复用，application-side pool 负责进程侧连接复用；两者不是互斥替代关系

这意味着：

- Python ingestion / closeout / registry 路径必须收敛到 shared pool/factory
- JS `app-api` 现有 pool 化方向保持不变
- pool size、timeout、lifetime 属于 runtime tuning，不再散落为 ad hoc CLI 行为

## 决策 5：Supabase Free / Nano 不是长期生产基线

固定规则：

- Free / `Nano` 可以承载小规模 metadata 实验或一次性导入验证
- 它不是 repo-owned sustained ingestion/control-plane 的 accepted production
  baseline
- 长期运行必须基于 paid compute，并以连接数、CPU、IO 与运行时延迟观测来选档

该决策冻结的是“不能把 Free / Nano 视为长期正式底座”，不在 repo 级冻结具体 region 或精确 compute 档位。

## 结果

- repo 获得一条单主线、低复杂度的 Postgres 连接策略： `IPv4-only runtime -> Supabase session
  pooler -> application-side pooling`
- 对象存储继续保持独立长期语义，不与 Supabase database/runtime 决策混写
- 后续 Python ingestion 性能改造的主方向明确为连接池化与热路径收敛，而不是引入 IPv6 判断、双 DSN 切换或
  transaction-mode alternate path

## Vendor References

- Supabase connecting to Postgres:
  <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase compute and connection limits:
  <https://supabase.com/docs/guides/platform/compute-and-disk>
- Supabase billing and free-plan quotas:
  <https://supabase.com/docs/guides/platform/billing-on-supabase>

## Complementary Docs

- `docs/data/shared-postgres-ownership.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/decisions/adr-0024-authenticated-notice-source-channel.md`
- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/decisions/adr-0026-authenticated-notice-batch-leased-closeout-throughput
  .md`
