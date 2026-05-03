---
doc_type: roadmap
status: completed
workstream: institutional-rules-retrieval-quality-baseline
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Institutional Rules Retrieval Quality Baseline

| Phase | Status | Deliverable |
|-------|--------|-------------|
| Phase 00: Golden Dataset v1 | completed | 89-case retrieval qrels, 42-case answer quality fixture, institutional no-hit guard, original 30-document live retrieval evidence |

## Closeout Rule

本 workstream 关闭后，只有在以下情况恢复：

- 42 条 admitted institutional rules 的 manifest / version truth 漂移导致 qrels 失效
- 新 institutional rule release 被显式 admission 并需要进入默认 consumption
- no-hit policy 重新允许未发布校级制度、院级 scoped-rule decoy 或虚构制度命中
- answer source identity contract 允许 scoped-rule URL 或错误 institutional title 满足
