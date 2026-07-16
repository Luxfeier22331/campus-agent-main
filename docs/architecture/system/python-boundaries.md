---
doc_type: architecture
owner_boundary: python-boundaries
status: active
---

# Python 边界

## 当前范围

Python 不参与在线回答、持久执行或默认采集数据面。当前 workspace 只准入隔离的
`packages/ragas-runner`，用于调用 Ragas 官方指标。

已删除的 supervisor、knowledge、retrieval 和 ingestion Python runtime 只通过 Git 历史追溯，
不得作为 fallback 恢复。

## 在线执行

- TypeScript `apps/agent-runtime` 拥有唯一 Agents SDK agent/tool loop；
- Go execution-control 拥有准入、Temporal、memory、internal query、evidence/finalization 和投影；
- Python 不消费在线 bridge envelope，也不作为 activity backend；
- Python 不拥有 provider cancellation、token/usage、workflow、projection 或 semantic routing。

`knowledge_query` 通过 SDK handoff 进入同一次 run 的 Knowledge Agent，后者只调用
`knowledge_search`。embedding、Qdrant hybrid RRF、evidence shaping 和 source validation 属于
execution-control，不存在 Python knowledge worker。

## 检索

旧 `packages/retrieval-core` 和 LlamaIndex runtime 已退役。在线检索固定为 repo DTO +
execution-control Qdrant adapter + 受控 evidence projection。

Python 不负责 query cache、registry lookup、ranking、merge/dedupe、target truth 或 tool admission。
当前排序是 Qdrant dense/sparse prefetch 与 native RRF。

## 采集数据面

默认 ingestion 由 TypeScript ingestion-control/source-collector、`packages/ingest-core` 和 Rust
kernel 负责。Python 不拥有：

- PostgreSQL、Qdrant 或对象存储 client lifecycle；
- provider、tokenizer、chunk profile 或 chunk preparation runtime；
- source truth、projection、registry、task lifecycle 或 alias publish；
- generic artifact/model DTO、split manifest 或 document import runtime。

需要 Python 生态的 extraction 能力时，必须重新准入为窄 adapter package/service，由 TS handler
显式调用并返回 canonical artifact 或 document unit。不得恢复默认 provider-response
materialization。

Rust kernel 可以在确定性边界使用本地 `tokenizer.json`/Hugging Face tokenizers；Python 不得
重新引入 transformers cache、semantic chunker、process pipeline 或 runtime network download。

PDF page count/split 可以使用轻量 parser 做本地 file kernel；默认 workspace 不恢复 PDF render
probe。课程地图等渲染消费已采集 sample，未来真实渲染需要显式 adapter。

## 保留的窄 helper

- `handbook_cleanup_manifest`：只校验学生手册逻辑边界；
- `layout_cleanup_common`：只服务 OCR/OOXML cleanup adapter；
- File asset metadata 使用 `FileAsset*`，不恢复 generic `RawAsset*` registry。

这些 helper 不拥有 canonical markdown、document unit、source truth 或通用 ingestion runtime。

## 约束

- repo/app 通用脚本使用 TypeScript/`tsx`，不新增 Python 治理入口；
- Python test 只服务已准入 Python island；
- root `uv.workspace.members` 只包含 `packages/ragas-runner`；
- contract 不引入 Go runtime、Qdrant、S3 或 provider SDK 类型；
- 不把 execution admission、evidence validation 或 source generation 写回 Python；
- 不把 ingestion 逻辑拉入 Agent Activity；
- 不以 Python fallback 掩盖缺少合同、性能或诊断问题。
