---
phase: "M"
name: "Curriculum Semester Answer Boundary Repair"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase M Context

## Goal

修复 public chat 中 curriculum semester answer 被 chunk 边界污染的问题：当 `program_semester_facts` 命中多个 partial chunk 时，用户可见答案不再出现 `中国民族史概要(一；`、`；展经济学` 这类断裂课程名。

## Current Truth

- `shared-product-surfaces-acceptance-hardening` 在 `Phase L` 后已经 closed。
- fresh local smoke 证明 `Phase L` 的 locator hygiene 仍然成立，但出现了新的 public answer contract breach：
  - 课程名被 chunk 边界切断后又被 generic prose 直接拼接到最终答案
- canonical truth 没坏：
  - `program_semester_facts` 在 MinIO 中的 `document-units.jsonl` 内容完整、无损坏课程名
  - `program_semester_facts` projection truth 也没有被错误写坏
- 真正的错误边界在 `rag-specialist`：
  - `program_semester_facts` 命中多个 partial chunk 时，仍沿用了 generic snippet concatenation
  - 导致答案把 partial snippet 的边界碎片原样输出

## Why This Phase Exists

这不是 retrieval baseline 损坏，也不是前端文案展示问题，而是 deterministic answer composition 边界错误：

- structured semester facts 本该按课程事实聚合，而不是按 chunk snippet 拼 prose
- 如果在前端做清洗，只会继续掩盖 specialist 边界错误
- 如果改 canonical projection truth，会把“读取方式错误”误判成“源数据错误”

因此必须按 workstream phase 在 `rag-specialist` 修边界，并用真实 public chat smoke 重新收口。

## Locked Decisions

### Boundary Decision

- 主修复点只放在 `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- 不在前端做 regex cleanup
- 不改 `program_semester_facts` projection truth
- 不改 MinIO canonical object

### Composition Decision

- `program_semester_facts` 不再走 generic snippet concatenation
- semester answer 改为从 supporting sources 中提取课程候选项、做边界折叠与去重，再输出 deterministic course list

### Smoke Decision

- 关闭前必须经过：
  - Python specialist regression
  - local direct execution smoke
  - `public-chat-web` local browser smoke
- local smoke 允许修正 operator 启动方式，但不把本地 bearer/trusted-worker 失配伪装成产品代码缺陷

## Existing Code Insights

### Retrieval Truth

- 本轮坏答案对应的是同一份 semester document 的两个 chunk：
  - `chunk-0001`
  - `chunk-0002`
- supporting sources 里的 snippet 本身就包含边界切断片段，因此 generic merge 会天然产出坏文案

### Source Truth

- clean canonical source object:
  - `curriculum/documents/program_semester_facts/法学-民族实验班-本科人才培养方案-第四学期课程事实--semester-4/source-faithful/2022/document-units.jsonl`
- canonical `clean_text` 完整包含课程列表，没有 fragment corruption

### Local Smoke Precondition

- `app-api` local worker 使用 `SUPERVISOR_API_SHARED_SECRET` 通过 `x-worker-origin-auth` 调 `supervisor-api`
- 本地 `supervisor-api` 必须以 `API_AUTH_MODE=trusted-worker` 启动
- 如果 operator 用默认 bearer 模式拉起 supervisor，会得到 `Invalid bearer token`，但这不是本 phase 的产品缺陷

## Non-goals

- 不重开 `Phase L`
- 不补前端脏词表或课程名黑名单
- 不修改 retrieval ranking、Qdrant 数据或 object storage 内容
- 不改 `app-api` finalize contract

## Canonical References

- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/ROADMAP.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/STATE.md`
- `.planning/workstreams/shared-product-surfaces-acceptance-hardening/REQUIREMENTS.md`
- `packages/rag-specialist/src/campus_rag_specialist/agent.py`
- `tests/specialist/test_rag_specialist.py`
- `apps/app-api/src/modules/integration/supervisor.ts`
- `apps/supervisor-api/src/campus_supervisor_api/auth.py`
- `apps/supervisor-api/src/campus_supervisor_api/api.py`
