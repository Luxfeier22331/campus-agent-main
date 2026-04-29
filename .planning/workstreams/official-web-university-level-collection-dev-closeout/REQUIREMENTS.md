---
doc_type: requirements
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Requirements: Official Web University-Level Collection Dev Closeout

## Goal

把校级 official web 采集从一次性 artifact evidence 推进到本地 dev 可重复执行、可验收、
可追踪的采集闭环。

## Scope

- 仅覆盖 `official_web/muc_public` 的校级 lane：
  - `university-core-hot`
  - `university-core-baseline`
- 补齐 dev runner / documented command，支持按 `lane_id` 运行校级采集。
- 补齐 worker / collector preflight，确保配置、lane、host allowlist、output/report 目录与
  artifact-only 安全边界可检查。
- 跑 fresh `university-core-baseline` evidence，并通过：
  - crawl artifact validation
  - QC
  - projection replay
  - projection validation
  - chunk audit
- 跑 repeated-run acceptance，验证同一 lane 连续运行不会制造重复 side effects。
- 补齐 report retention 和 alert summary 规则。
- 补齐 import/promote handoff dry-run，不自动 promotion。

## Non-Goals

- 不启动院级全量采集。
- 不把 `college-single-host-baseline` 变成 enabled recurring lane。
- 不打开 `fresh_news` / `news_archive` query-serving surface。
- 不改变 product routing gate、retrieval serving profile 或 `app-api` control-plane ownership。
- 不把本地 `.tmp` artifact 写成线上或 registry current truth。
- 不在本 workstream 内解决所有 official web news opening 问题。

## Success Criteria

- 能用稳定 dev command 按 `lane_id` 跑 `university-core-hot` 和
  `university-core-baseline`。
- preflight 对缺配置、未知 lane、disabled lane、host 不在 allowlist、不可写 output/report
  目录、误触 import/promote 等场景 fail-close。
- 至少一次 fresh `university-core-baseline` run 通过 source validation、QC、projection
  validation 和 chunk audit。
- 至少两次连续 `university-core-baseline` run 生成 repeated-run comparison report，并证明
  document identity / canonical hash / semantic hash 稳定或差异可解释。
- retention / alert 规则有可运行 dry-run 或 summary artifact。
- import/promote handoff dry-run 证明目标 collection 分流正确，且没有实际 promotion。
- 所有 evidence 路径写入 `STATE.md`。

## Acceptance Evidence To Produce

- dev lane run report
- preflight report
- crawl output root
- source-truth validation report
- QC report
- projection output root
- projection validation report
- chunk audit report
- repeated-run comparison report
- retention dry-run report
- alert summary report
- import/promote handoff dry-run report
