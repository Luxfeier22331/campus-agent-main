# `authenticated_documents/file_release_source`

本目录定义 `internal_portal/file_release` 来源记录和已发布原文件的来源信息。

当前边界：

- `internal_portal.file_release.capture` 负责采集并生成已验证的来源清单；
- 处理止于来源事实和文档暂存，原始资产注册表指向已发布原文件字节；
- `reference_only` 记录失败关闭，不进入此暂存范围；
- 本目录不负责提升为规章，也不提供文档中心读取能力。

来源数据结构见 `docs/data/internal-portal.md`，采集运行边界见
`docs/architecture/system/data-plane.md`。
