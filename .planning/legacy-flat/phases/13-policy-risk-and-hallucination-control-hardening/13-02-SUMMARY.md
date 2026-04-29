# 13-02 Summary

## Outcome

- `rag-specialist` 的 grounding validator 已从原先的 `title / time / requirement` 扩展到五类高信号 claim：
  - `title_claims`
  - `time_claims`
  - `requirement_claims`
  - `offering_unit_claims`
  - `audience_claims`
- prompt-generated answer 现在如果编造“开课学院/开设单位”或“哪些专业/哪些学生要上”这类 evidence 不支持的 claim，会继续沿现有 post-LLM downgrade path fail-close 到 `unsupported_by_evidence`。
- `unsupported_fields` diagnostics 继续保留并显式暴露新的 claim family，后续 `13-03` 可以直接把这些字段接进 eval / observability。

## Verification

- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.specialist.test_rag_prompting tests.supervisor.test_supervisor_core`
  - `157 tests OK`
