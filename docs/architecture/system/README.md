---
doc_type: index
status: active
created: 2026-04-23
updated: 2026-06-04
---
# System Architecture

`system/` 承接跨域 supporting architecture。它负责 repo-wide runtime、routing、
execution、retrieval、data-plane、observability 等系统级边界。

## 当前文档

- `product-runtime-architecture.md`
- `code-organization-and-decomposition-architecture.md`
- `capability-routing-and-admission-architecture.md`
- `document-site-architecture.md`
- `runtime-delivery-and-release-hardening-architecture.md`
- `execution-and-agents-architecture.md`
- `durable-agent-runtime-architecture.md`
- `prompt-and-instruction-architecture.md`
- `identity-and-authorization-architecture.md`
- `identity-platform-architecture.md`
- `hub-account-experience-architecture.md`
- `federation-and-mucwiki-login-architecture.md`
- `retrieval-serving-architecture.md`
- `agentic-retrieval-architecture.md`
- `data-plane-architecture.md`
- `file-asset-loader-architecture.md`
- `operator-observability-architecture.md`
- `python-capability-boundaries.md`

## 使用规则

- 这里只承接跨域 supporting truth，不承接领域级 source-channel 细节
- 这里只解释边界与 owner，不维护 phase 状态或 closeout 历史
- 如果某段内容已经收敛成明确领域边界，应优先下沉到 `../domains/`
