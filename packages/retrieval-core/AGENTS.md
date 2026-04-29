# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `packages/retrieval-core` 的局部规则。

## Role

这个 package 承载 online retrieval kernel。

- 负责 retrieval request projection、step execution、merge / dedupe、evidence shaping
- 负责 Qdrant runtime adapter、embedding query cache 与 registry-backed source metadata
- 不负责顶层 capability admission、product routing 或 query-enabled scope truth

## Module Rules

- `service.py` 是 facade；request projection 放在 `service_requests.py`，step execution
  result / replan validation / source trust filtering 放在 `service_execution.py`
- `backend_qdrant.py` 是 backend orchestration facade；errors、embedding cache、evidence
  source shaping、registry lookup 必须分文件维护
- 不要把 Qdrant / LlamaIndex / registry implementation type 泄漏到 `packages/contracts`
- 不要让 agent 直接依赖 backend private helper；需要共享时先提到 retrieval-core 内部模块

## Verification

优先使用这些命令验证本目录相关变更：

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.retrieval_core_structure_suite \
  tests.retrieval.test_backend_qdrant \
  tests.retrieval.test_service -q
uv run --all-packages ruff check packages/retrieval-core/src tests/retrieval
```
