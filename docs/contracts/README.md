---
doc_type: index
owner_boundary: docs/contracts
status: active
---
# 合同

`docs/contracts/` 保存稳定的 HTTP、运行时、DTO 和工具边界。

- 浏览器与 App API：[app-api/README.md](./app-api/README.md)；
- 工具执行：[tool-execution.md](./tool-execution.md)、
  [tool-read-model.md](./tool-read-model.md)、[tool-trajectory.md](./tool-trajectory.md)；
- 持久执行与队列：[durable-runtime.md](./durable-runtime.md)、
  [operator-runtime.md](./operator-runtime.md)；
- 观测与评测：[langfuse-runtime.md](./langfuse-runtime.md)、
  [stage-timing.md](./stage-timing.md)、[ops-web.md](./ops-web.md)；
- 文档发布：[document-reader-publish.md](./document-reader-publish.md)、
  [file-release-export.md](./file-release-export.md)。

跨语言合同优先使用 `schemas/` 和 `packages/contracts/schemas/` 中登记的 OpenAPI 或 JSON
Schema；语言本地类型和解析器不得成为第二份跨语言事实。
