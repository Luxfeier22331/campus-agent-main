# `authenticated_documents/file_release_source`

本配置范围保存规范的 `internal_portal/file_release` 来源记录，以及已发布原文件的来源信息。

当前边界：

- 处理止于来源事实和文档暂存；
- 原始资产注册表指向已发布原文件的字节内容；
- `internal_portal.file_release.capture` 来源采集 activity 负责采集并生成已验证的来源清单；
- `reference_only` 采集记录采用失败关闭，不进入此暂存范围；
- 此范围不负责提升为规章，也不提供受限文档中心读取能力。
