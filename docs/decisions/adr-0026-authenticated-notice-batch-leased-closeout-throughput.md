---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0026
status: accepted
created: 2026-04-05
updated: 2026-04-05
---
# ADR-0026 Authenticated Notice Batch-Leased Closeout Throughput Model

适用范围：`authenticated_notice_portal` historical closeout throughput
redesign、planning/worker split、batch leasing、worker progress truth、lightweight
operator status、single-promoter parallel copy

## 背景

ADR-0025 已把 authenticated notice historical closeout 从 legacy cumulative-prefix
replay 收口为 async staged closeout，但第一版 executor 的热路径仍然保留了三个吞吐瓶颈：

- 并发只停在 shard 级，shard 内部仍然串行处理 notice
- 每条 notice 的 source-truth / staged document / heartbeat / stage-row 提交存在明显写放大
- `start_run` 仍然先对整份 bundle 执行 eager prepare/import，然后才真正进入 batch 执行

在 `6694` 条 historical notice 的真实 run 中，这个模型表现为：

- 只有 `max_concurrency` 个 shard 同时运行
- 每个 shard 的 `250` 条 notice 需要长时间串行等待
- operator `show` 依赖扫描 staged rows 或长事务 CLI，无法作为实时进度面

因此 repo 需要在保持 ADR-0025 data-plane 边界不变的前提下，把执行模型升级为真正的 `planning -> planned
batches -> leased workers -> verifying -> promotion` pipeline。

## 决策 0：planning 与 execution 必须物理解耦

canonical run lifecycle 固定为：

`planning -> planned -> running -> verifying -> verified -> promoting ->
done|failed`

固定规则：

- planning 负责读取 frozen bundle、生成 shard/batch plan、写入 run metadata，并把每个 batch 的
  frozen input slice 持久化到 operations prefix
- planning 不得执行整份 bundle 的 source-truth prepare，更不得在 `planned` 之前开始
  source/staged object 上传
- worker 只允许围绕自己 claim 到的 batch 读取 frozen input slice，并在本地为该 batch 构造 prepared
  imports
- verification 必须在所有 batch 完成之后单独触发；promotion 仍然只允许 verified run 进入

因此 `start_run` 式 eager import 不再是 canonical shape。

## 决策 1：执行单元从 shard 升级为 batch

canonical closeout pipeline 升级为：

`frozen bundle -> shard plan -> batch plan -> frozen batch inputs -> leased
worker pool -> parallel source/derived staging -> batch commit -> deterministic
verification -> single promoter -> replace_scope`

固定规则：

- shard 仍然是 planning / aggregation 边界，不再是热路径执行单元
- batch 成为真正的调度、lease、重试、进度统计边界
- 单个 worker 可以顺序消费多个 batch；多个 worker 可以并发消费同一 run 的不同 batch

## 决策 1.1：每个 batch 必须持有冻结输入

每个 planned batch 都必须写出 repo-owned frozen input artifact。

推荐对象布局：

- `campus_notices/operations/authenticated-notice-closeout/{run_id}/batches/{bat
  ch_id}/input.json`
- `campus_notices/operations/authenticated-notice-closeout/{run_id}/batches/{bat
  ch_id}/manifest.json`

其中：

- `input.json` 持有该 batch 的 notice bundle slice 与 planning-time request metadata
- `manifest.json` 持有 batch state、lease、attempt、worker owner、timing 与统计

worker 不得重新扫描全量 bundle 以恢复自己的 notice slice。

## 决策 2：closeout schema 新增 batch 与 worker truth

`ingestion_closeout` schema 在 ADR-0025 的表基础上新增：

- `closeout_batches`
- `closeout_workers`

语义固定为：

- `closeout_runs` 记录 run 级聚合进度、batch/shard 计数、staged 计数、verification / promotion
  结果
- `closeout_shards` 记录 shard 级 planned/completed notice 与 batch 聚合进度
- `closeout_batches` 记录 batch lease、worker owner、attempt、planned/processed
  notice count、state、error、timing
- `closeout_workers` 记录 worker heartbeat、active batch count、completed batch
  count、last progress time

`closeout_notice_stage` / `closeout_raw_asset_stage` / `closeout_document_stage`
继续作为 staged truth，但热路径写入必须以 batch 为单位提交，而不是每条 notice 单独提交。

## 决策 3：operator status 必须只读聚合 truth

`show_authenticated_notice_closeout` 的 canonical truth 改为：

- `closeout_runs` 聚合字段
- `closeout_shards` / `closeout_batches` / `closeout_workers` 的轻量计数查询
- promotion 进入后继续读取 `closeout_promotions` / `closeout_promotion_batches` 的 phase
  与 batch 级聚合计数

禁止：

- 为了 `show` 扫描全部 staged notice/raw/document rows
- 通过长时间阻塞的 importer stdout 推断 run 是否存活

repo 必须提供：

- `show_authenticated_notice_closeout --run-id <id>`
- `watch_authenticated_notice_closeout --run-id <id> --interval <seconds>`

## 决策 4：hot path 写放大必须分层收敛

新的 throughput model 固定为：

- source artifacts 使用共享 uploader pool 并发写 canonical source keys
- staged document artifacts 使用共享 uploader pool 并发写 operations prefix keys
- batch 完成后一次性批量写 staging tables 与 run/shard/batch/worker 聚合状态
- worker heartbeat 按时间窗或 batch 提交写入，不再按每条 notice 写一次 object-store heartbeat

这意味着：

- `heartbeat/shard-0001.json` 退出热路径
- canonical progress truth 转移到 `closeout_workers` / `closeout_batches` /
  `closeout_runs`
- operations prefix 仍保留 run manifest、plan、milestones、batch manifest 与 promotion
  evidence

## 决策 4.1：batch staging commit 必须是单事务

固定规则：

- 单个 batch 的 notice/raw/document stage rows 必须与 batch/shard/worker/run
  聚合状态在同一数据库事务内提交
- 不允许先逐条写 staged rows，再在外围补 run/shard/batch counters
- in-memory store 必须保持与 Postgres store 同样的 commit 语义，以便测试直接覆盖 canonical shape

## 决策 5：verification 改为 metadata-driven

verification 必须避免对所有 staged document objects 执行全量回读。

固定规则：

- staged upload 时必须写入 `sha256` / `content_length` 等 metadata
- verification 通过 staged rows + object `HEAD` / metadata 校验对象存在和内容摘要
- `source-truth/notice-manifest.json` existence 继续作为 hard gate
- final promotion 前不得因为验证路径本身而触发整批对象正文回读

## 决策 5.1：verification 由单个 finalizer 收口

固定规则：

- worker 在发现没有可 claim batch 后，可以尝试把 run 从 `running` 原子切到 `verifying`
- 同一 run 只允许一个 finalizer 成功进入 `verifying`
- 其他 worker 在 run 已进入 `verifying` / `verified` / `promoting` / `done` / `failed`
  后必须退出，不得重复执行 verification

## 决策 6：single promoter 不变，但复制允许内部并发

single-promoter 语义保持不变：

- 只有一个 promoter 可以执行 final `replace_scope`
- shard / worker / batch 都不得直接写 canonical
  `campus_notices/documents/internal_notice`

同时固定允许：

- promoter 内部并发执行 staged object -> final object 的 object-store native copy
- raw asset upsert 与 final registry row materialization 采用 bulk-friendly 路径
- promoter 必须把自身 phase、copy batch 进度、错误与恢复点持久化到 repo-owned promotion
  truth；promotion restart 只重试未完成 batch，不得清空已完成 copy 结果后重来

因此 single-writer 限制的是最终 scope mutation，而不是 promoter 内部的 copy throughput。

## 结果

- authenticated notice closeout 的 canonical execution truth 升级为 batch-leased
  pipeline
- `show` / `watch` 成为 repo-owned operator surface
- batch / worker truth 进入 `ingestion_closeout`
- staged closeout 的吞吐优化不改变 source-channel / data-plane / single-promoter 的架构边界

## Complementary Docs

- `docs/decisions/adr-0025-authenticated-notice-async-staged-closeout.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/runbooks/ingestion-control-clean-target-runbook.md`
