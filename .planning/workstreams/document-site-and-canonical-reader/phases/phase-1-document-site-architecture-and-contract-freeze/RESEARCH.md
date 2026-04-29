---
doc_type: research
status: active
created: 2026-04-21
updated: 2026-04-23
---

# Phase 1 Research

## External Product Patterns

### Docs-first + AI assist is the dominant mature pattern

- GitBook Assistant 将 AI 定位为嵌入 docs 或产品中的助手，而不是替代 docs 的独立门户：
  - https://gitbook.com/docs/publishing-documentation/gitbook-ai-assistant
- Mintlify Assistant 明确把回答建立在 docs 上，并回到 docs 阅读面：
  - https://www.mintlify.com/docs/assistant/index
- ReadMe Ask AI 继续把 docs、版本、权限和 AI 回答放在同一平台语义内：
  - https://docs.readme.com/main/docs/ask-ai

对 repo 的直接含义：

- 文档站应是第一阅读面
- AI 应回链 canonical docs
- 不应把 chat 设计成替代 docs 的唯一 surface

### Version and branch are first-class concepts

- ReadMe 把 versions / branches 作为平台级能力：
  - https://docs.readme.com/main/docs/versions
  - https://docs.readme.com/main/docs/branches
- Docusaurus 也把 versioning 作为正式文档能力，而不是后补：
  - https://docusaurus.io/docs/versioning

对 repo 的直接含义：

- `versionId` / `versionSlug` 必须从第一天进入 docs contract
- 当前即使只开放 current reader，也不能把历史版本语义留空

### Citation should target canonical text units, not raw retrieval chunks

- Anthropic citations 文档强调可引用单位与最终引用是显式 contract：
  - https://platform.claude.com/docs/en/build-with-claude/citations
- Azure agentic retrieval / answer synthesis 也把 references 与最终 answer 分层：
  - https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-retrieve

对 repo 的直接含义：

- chat source cards 不应直接暴露 raw retrieval/source trace
- 用户态 citation target 应跳到 canonical reader
- `chunkId` 不应成为用户 URL contract

## Open-Source Shell References

- Starlight 适合作为 docs-first shell donor 参考：
  - https://starlight.astro.build/zh-cn/guides/i18n/
- Docusaurus 适合作为 version-heavy docs shell 参考：
  - https://docusaurus.io/docs/versioning

工程判断：

- donor 可以借鉴它们的 docs shell / information architecture
- 但 canonical document truth、version truth、authz truth 仍必须保留在 repo 自己的 `app-api + canonical document chain`

## Not Appropriate To Borrow As Truth Owner

- GitBook / Mintlify / ReadMe 是很好的产品形态参考，但不适合替代 repo 的 canonical truth owner
- PDF reader / PDF highlighter 方案不适合当前场景，因为用户已明确只提供 canonical doc

## Deployment / Delivery Research

- Cloudflare Workers Static Assets 官方说明：静态资源命中时可直接由 assets 层返回；未命中时再进入 Worker；并支持 `run_worker_first` 选择性控制路由：
  - https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Workers Vite plugin 官方说明：同一 Worker 应用可同时构建前端静态资源与全栈逻辑，并原生支持 static sites、SPAs、full-stack apps：
  - https://developers.cloudflare.com/workers/vite-plugin/
  - https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/

对 repo 的直接含义：

- `public-docs` 继续保持 Worker 部署目标是成立的
- public published reader content 适合走 static assets
- `/api/docs/*` 继续保留 control-plane seam
- restricted/gated reader 不能因为采用同一种 reader asset format 就退化成匿名 static path

## Summary

外部成熟模式与 repo 现有边界高度一致：

- docs-first
- AI answer -> canonical docs jump
- version/visibility first-class
- citation unit 与 raw retrieval trace 分层

因此 `public-docs static reader assets + app-api docs control plane + canonical reader projection` 是与仓库最一致的方向。
