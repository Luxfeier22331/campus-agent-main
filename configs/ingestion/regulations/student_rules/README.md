# student_rules 配置

本目录保存学生手册和学生管理规章的规范化、分块和来源投影配置。它是独立的
ingestion 配置，当前 Campus Docs publisher 不读取本目录来生成在线索引。

## 文件

- `canonical-profile.json`：文档身份与元数据；
- `chunk-profile.json`：分块规则；
- `source-projections.v1.json`、`split-manifest.v1.json`：公开合成来源与逻辑文档边界。

当前在线 Campus Docs 索引只由 Campus Web 的 `campus-docs/source.json`
和其引用的 `campus_docs_reader.v3` 生成；真实来源数据不由公开合成 fixture 替代。

领域边界见 `docs/architecture/domains/regulations.md`，学生手册处理规则见
`docs/policies/student-rules-chunking.md`。
