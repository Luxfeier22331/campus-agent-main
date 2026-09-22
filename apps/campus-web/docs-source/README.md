# 文档来源声明

本目录是低频维护的 Docs 元数据编辑源。reader 正文、课程图来源、图片和原始文件保存在 RustFS；
不要把正文、对象摘要、字节数、凭据或 RAG 产物提交到本目录。

- `collections.yaml`、`topics.yaml`、`redirects.yaml` 分别保存集合、主题和旧正文重定向。
- `documents/<corpus>/<collection>/<routeSlug>/document.yaml` 保存 `docId`、`documentSlug`、标题和归属。
- 同目录的 `versions/<versionSlug>.yaml` 保存完整 `versionId`、`docId`、`versionSlug`、`readerKey` 与 `supplements`。
- 补充数据登记 `kind`、公开 `path`、来源 `objectKey`，图片登记 `assets[].key` 和公开 `assets[].path`。

目录沿用现有公开路由 slug，不从文件名重建文档或版本 ID；非 ASCII 文档短名使用现有路由生成规则。
年份、序号等版本 slug 是字符串，在 YAML 中加引号。同一文档的数值最大版本仍是默认版本。

先上传新对象，再修改对应声明。重复 ID、未知字段、非法版本、对象路径和无效重定向会在
`pnpm --dir apps/campus-web docs:source:check` 阶段失败，该检查不访问对象存储。
实际对象存在性、reader 身份和课程图结构由发布器完整校验后才更新固定来源键。

声明合并后由现有 Campus Web 候选流水线发布；本地重放、连接选择、冲突处理与回滚见
[Docs 维护手册](../../../docs/runbooks/campus-docs.md)。
