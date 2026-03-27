# campus-availability-specialist

`packages/availability-specialist` 是当前显式存在的 availability specialist 边界。

它负责：

- 接收 `availability-specialist` 的 typed specialist handoff
- 解析 allowlisted target
- 执行受控 availability probe
- 返回 typed `AvailabilityObservation` / `SpecialistResponse`

它不负责：

- supervisor routing / final response assembly
- retrieval、Qdrant、registry 或 ingestion
- 把外部探测能力提升为 supervisor 级共享工具

当前它与 `rag-specialist` 并列存在，但不改变 `apps/supervisor-api -> packages/supervisor-core -> specialist` 的主边界分层。
