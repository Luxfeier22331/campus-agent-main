---
doc_type: requirements
status: active
created: 2026-04-22
updated: 2026-04-22
---

# Requirements: Curriculum Course Map Multimodal Probe

## Goal

在不改动当前 `课程地图` fail-close runtime truth 的前提下，为 `curriculum/curriculum_plan` 建立一条受控的离线多模态探针链路，用真实课程地图页判断是否存在后续 bounded admission 的价值。

## In Scope

- 基于 `split-manifest + provider-response + layout-elements` 建立课程地图 image-row inventory
- 固定 sample-set 与 fixed gold pages
- PDF page render、provider-bbox -> PDF crop、multi-image strict-schema prompt request
- repeatability scorer、gold scorer、admission summary
- `apps/ingestion-worker` 的 probe CLI
- probe artifact 输出与 targeted unittest

## Non-goals

- 修改当前 `rag-agent` / retrieval / eval 对课程地图 query 的 fail-close 口径
- 把 probe 直接升级成 source-truth parser、document-units materialization 或 chunking lane
- 打开 `curriculum_plan` 的课程地图可答 surface
- 把多模态 image input 平台化成 repo-wide prompt-runtime 重构
- 修改 public-chat、panel、docs site 或 staging runtime

## Success Criteria

1. repo 内存在可重复执行的课程地图 probe 模块与 worker CLI，而不是一次性脚本。
2. probe 默认消费真实 source bucket artifact key 与固定 sample/gold manifest。
3. 结果能输出 repeatability / gold / admission 三层报告，并明确给出 `not_admitted_keep_fail_close`、`bounded_probe_only` 或 `bounded_candidate_for_follow_up`。
4. 所有新增能力都停留在离线 probe 边界，不提前写入 query-serving 主链路。
