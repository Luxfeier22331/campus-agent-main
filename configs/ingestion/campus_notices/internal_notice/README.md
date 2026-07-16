# internal_notice 配置

本目录保存内部门户通知的离线清洗与校验配置。配置存在不代表通知已经进入在线检索或模型
工具；来源采集由中央任务注册表中的 `internal_portal.notice.capture` 负责。

## 文件

- `canonical-profile.json`：规范文档单元和集合标识；
- `chunk-profile.json`：离线分块参数；
- `notice-family-classification.v1.json`：确定性通知分类与附件保留规则；
- `serving-config.json`：当前离线状态和检索关闭配置；
- `task-registry.v3.json`：规范文档单元的 Rust 校验任务。

来源采集结果见 `docs/data/internal-portal.md`，采集任务边界见
`docs/architecture/system/data-plane.md`。规章提升和范围规则分别见 ADR-0035 与 ADR-0037。
