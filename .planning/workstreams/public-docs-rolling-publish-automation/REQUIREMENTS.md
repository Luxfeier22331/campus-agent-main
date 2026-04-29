---
doc_type: requirements
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Requirements: Public Docs Rolling Publish Automation

## Goal

让 `apps/public-docs` 能随着 ingestion 侧 publish manifest 的变化自动滚动发布：
北京时间每天 `00:00 / 06:00 / 12:00 / 18:00` 检查 manifest；如果 manifest
相对最后成功发布版本发生变化，则执行 build、smoke、deploy 与 ledger 记录；如果无变化，则明确跳过。

controlled runner 使用 UTC cron `7 4,10,16,22 * * *` 触发，落在上述北京时间窗口后的
7 分钟内。

## In Scope

- manifest pointer / digest / release id comparison contract
- deploy release ledger 与状态机
- no-change skip
- single-flight lock，避免同一 surface 并发发布
- manifest schema validation
- reader asset existence / checksum validation
- public static bundle restricted-content guard
- `apps/public-docs` build / preview smoke / deploy pipeline integration
- staging 与 prod 的分离配置、dry-run 与 rollout evidence
- failure handling、retry 与 rollback drill
- 可选 deploy-hook / webhook nudger，作为后续即时触发入口

## Non-goals

- 不修改 canonical reader data model
- 不重做 `apps/public-docs` UI / layout / reader shell
- 不让 `public-docs` runtime 扫描对象存储
- 不让浏览器直接读取对象存储
- 不把 Worker Cron 设计成执行 wrangler deploy 的 runtime
- 不把 restricted / gated reader content 混入匿名 public static bundle
- 不替代 ingestion 侧 manifest 生成与发布职责

## Publish Invariants

1. ingestion / publish pipeline 先发布 immutable reader assets，再原子更新
   current manifest pointer。
2. deploy job 只读取 current pointer 与 immutable manifest，不通过列 bucket 自行推断发布子集。
3. manifest digest 是是否需要发布的判定来源。
4. ledger 中的 `deployed` 只代表 build、smoke 与 deploy 全部通过后的 release。
5. 失败发布不得推进 deployed pointer，也不得删除上一次成功发布的静态站。
6. restricted / gated / withheld entry 不得进入 public anonymous static assets。
7. operator 可以 dry-run 看到 candidate manifest、diff、校验结果与会执行的命令。

## Required Ledger Fields

- surface: `public_docs`
- environment: `staging` / `prod`
- candidate release id
- candidate manifest digest
- previous deployed release id
- previous manifest digest
- status: `checking` / `skipped` / `validating` / `building` / `smoking` /
  `deploying` / `deployed` / `failed` / `rolled_back`
- runner id
- lock id
- started / completed timestamps
- failure reason
- deployed artifact identifier
- Cloudflare deployment id when available

## Success Criteria

1. repo 中存在独立 native workstream，明确把 rolling publish automation 与 docs shell
   implementation 分开。
2. Phase 1 完成后，有可执行的 manifest check + ledger contract，能 dry-run 判断
   `changed / unchanged / invalid / blocked`。
3. Phase 2 完成后，scheduled runner 能按北京时间四个窗口触发，并具备 single-flight。
4. Phase 3 完成后，changed manifest 能自动完成 sync、build、smoke、deploy 与 deployed
   ledger 记录。
5. Phase 4 完成后，失败与 rollback 行为有机器可验证 evidence。
6. Phase 5 完成后，deploy-hook nudger 可以触发一次同样的 manifest check，但不绕过 manifest
   digest validation。
7. Phase 6 完成后，staging / prod runbook、dry-run evidence、no-change evidence、
   changed-manifest evidence 与 rollback drill evidence 全部落盘。

## Canonical Entry

- `.planning/workstreams/public-docs-rolling-publish-automation/README.md`
