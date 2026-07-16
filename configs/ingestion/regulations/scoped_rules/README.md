# scoped_rules 配置

本目录保存 `regulations/scoped_rules` 的仓库配置 scaffold。

## 配置文件

- `serving-config.json`：collection serving gate 和 index compatibility；
- `canonical-profile.json`：imported scoped-rule document 的 identity 和 provenance；
- `chunk-profile.json`：canonical scoped-rule text 的 chunk-preparation 配置。

## Collection 边界

该 collection 只接受 canonical scoped rule text：

- `annual_cycle_rule`；
- `time_bound_operational_rule`。

wrapper notice 保留在 `campus_notices/internal_notice`；稳定校级规章属于
`regulations/institutional_rules`；没有当前产品用途的历史年度通知不进行 target
publication。

## 当前执行能力

active v3 task registry 只接收 digest-pinned canonical `document-units`，并调用 Rust kernel
执行 validation/chunk preparation。仓库没有 source materialization 或 promotion task，也
不保留 Python scoped-rule materializer。

该 collection 不在 `configs/runtime/query-serving-targets.v1.json` 中，因此不能在线查询。
serving config、canonical profile 和 chunk profile 的存在只描述目标兼容性，不代表已经
materialize、publish 或对 RAG/reader 开放。

未来开放查询前，需要独立定义 applicability、effective time、history/as-of/compare、
filter 和 evaluation 合同。

## 相关文档

- `docs/decisions/adr-0037-scoped-rules.md`
- `docs/decisions/adr-0035-regulation-promotion.md`
