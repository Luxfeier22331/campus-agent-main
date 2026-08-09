---
doc_type: index
owner_boundary: docs/contracts
status: active
---
# 合同

`docs/contracts/` 保存稳定的 HTTP、运行时、DTO 和工具边界。

- 浏览器与 App API：[app-api/README.md](./app-api/README.md)；
- 工具执行：[tool-execution.md](./tool-execution.md)、[tool-trajectory.md](./tool-trajectory.md)；
- 观测与评测：[langfuse-runtime.md](./langfuse-runtime.md)、
  [stage-timing.md](./stage-timing.md)、[ops-web/README.md](./ops-web/README.md)；
- 文档来源与静态交付：[document-reader-delivery.md](./document-reader-delivery.md)；
- 内部门户文件发布采集：[internal-portal-file-release.md](./internal-portal-file-release.md)。

跨语言合同优先使用 `schemas/` 和 `packages/contracts/schemas/` 中登记的 OpenAPI 或 JSON
Schema；语言本地类型和解析器不得成为第二份跨语言事实。
