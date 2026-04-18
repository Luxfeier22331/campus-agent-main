---
phase: 10-official-web-serving-surface-stratification-and-fresh-news-readiness
plan: "03"
status: completed
completed_at: "2026-04-04T13:13:17+08:00"
---

# 10-03 Summary

## Outcome

当前 official-web answer path 已对 freshness-sensitive asks 显式 fail-close：

- retrieval layer 会根据 runtime-profile truth 拒绝 `今天/最新/最近` 这类 freshness-sensitive official-web queries
- specialist no-answer copy 已改成 scope-specific wording，明确说明当前本地官网页面链路还不支持这类时效敏感问题
- official-web release-gate eval 已新增 `official-web-release-gate-freshness-sensitive-no-answer`

现在 future changes 即使改动 retrieval / answer 逻辑，也不能悄悄重新放开当前 mixed local collection 对 fresh-news 风格问题的回答。

## Verification

- `uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.specialist.test_rag_specialist`: pass
- `uv run --all-packages python -m unittest tests.evals.test_official_web_live_benchmark`: pass

## Locked Repo Truth

- current `official_web/muc_public_pages` 只支持 stable-reference-like targeted asks
- freshness-sensitive asks 必须 fail-close，而不是用混合本地页面硬答
- 本次工作只锁 current-scope serving correctness，没有扩采，也没有打开 default query-serving
