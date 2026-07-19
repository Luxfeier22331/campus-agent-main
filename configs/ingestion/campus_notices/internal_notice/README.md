# internal_notice 配置

本目录保存内部门户通知的物化、校验与分类配置。离线发布不代表通知已经进入在线检索或模型
工具；来源采集由中央任务注册表中的 `internal_portal.notice.capture` 负责。

## 文件

- `notice-family-classification.v1.json`：确定性通知分类与附件保留规则；
- `task-registry.v3.json`：通知物化和规范文档单元校验任务。

本范围不声明 chunk、Qdrant 或 query-serving 配置。未来在线检索链路必须独立设计并在
`configs/runtime/query-serving-targets.v1.json` 显式准入。

来源采集结果见 `docs/data/internal-portal.md`，采集任务边界见
`docs/architecture/system/data-plane.md`。规章提升和范围规则分别见 ADR-0035 与 ADR-0037。
