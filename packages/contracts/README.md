# campus-contracts

`packages/contracts` 定义 `campus-agent` 的共享 schema 边界。

它负责：

- supervisor-facing `SupervisorRequest`
- supervisor -> specialist 的 `SpecialistRequest` / `SpecialistResponse`
- retrieval-oriented `EvidenceBundle`
- navigation / structured-runtime handoff 所需的共享 payload / result 分支
- trace、actor、error、scope 等共享 dataclass 与枚举

它不负责：

- runtime / framework / transport 类型
- retrieval backend、Qdrant、MinIO、registry 或其他基础设施类型
- specialist 内部实现细节

当前它已经不是 rag-only contract 面；共享 handoff 现在覆盖 `rag-specialist`、`navigation-specialist` 与已 admission 的 structured runtime target。
