# internal_notice 配置

本目录保存内部门户通知的规范化、分块和校验配置。来源采集由中央任务注册表中的
`internal_portal.notice.capture` 负责；这些文件存在不表示通知已经进入在线检索或模型工具。

## 文件

- `canonical-profile.json`：规范文档单元；
- `chunk-profile.json`：离线分块参数；
- `notice-family-classification.v1.json`：确定性通知分类与附件保留规则；
- `serving-config.json`：索引与在线查询状态；
- `task-registry.v3.json`：规范文档单元的 Rust 校验任务。

来源采集结果见 `docs/data/internal-portal.md`，采集任务边界见
`docs/architecture/system/data-plane.md`。规章提升和范围规则分别见 ADR-0035 与 ADR-0037。
