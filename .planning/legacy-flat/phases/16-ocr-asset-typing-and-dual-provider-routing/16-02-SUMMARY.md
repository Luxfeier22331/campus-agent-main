# 16-02 Summary: 结构化 dual-provider compare 与 adjudication evidence

## Outcome

Phase 16 的第二步已经落地：现有 sidecar compare lane 不再只是把两份 OCR 输出并排落盘，而是会生成可重复消费的 adjudication evidence。

这一步完成了三件事：

- compare core 现在会稳定记录 per-provider `status`、`provider_response_available`、`usable_output`、`empty_output`、`error_type` 和 `structure_signals`
- candidate provider 即使出现 hard failure，也不会让 compare 整体中断；`comparison.json` / `summary.json` 仍会落盘
- winner-selection 明确变成保守规则：provider failure 和 empty-output 可以直接判定，纯 `plain_text_length` 差异不能直接决定 canonical winner

## Key Changes

- `packages/ingestion-core/src/campus_ingestion_core/online_ocr_compare.py`
  - compare lane 新增 candidate fail-capture，不再只支持 happy-path 输出
  - `comparison.json` 新增 `adjudication`
  - per-provider summary 新增结构化状态字段与简单 structure/noise signals
  - winner-selection 现在优先消费 failure / empty-output / markup inflation / clear structure advantage，而不是只看字符数
- `tests/ingestion/test_online_ocr_compare.py`
  - 新增 empty-output、provider contract failure、以及“长度差不直接决定 winner”的回归测试
- `apps/ingestion-worker/README.md`
  - 补 operator-facing compare evidence 说明
- `env/commands/compare-online-ocr.env.example`
  - 补输出文件与 adjudication evidence 注释

## Verification

Automated:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_online_ocr_compare \
  tests.ingestion.test_compare_online_ocr_worker
```

Result:

- `Ran 6 tests`
- `OK`

Targeted live reruns:

- `uv run --all-packages campus-ingestion-compare-online-ocr --file-path .tmp/auth-cookie4-runtime/pdf-policy-samples-20260409/351896-attachment-01.pdf --output-dir .tmp/ocr-compare-batch/20260412-phase16-validation/pdf-351896-paddle-candidate`
  - candidate `status=failed`
  - candidate `error_type=OnlineOcrProviderContractError`
  - adjudication `winner=none`, `reason_codes=["candidate_provider_failure", "baseline_unavailable"]`
- `set -a; source .env.mineru.compare; set +a; uv run --all-packages campus-ingestion-compare-online-ocr --file-path .tmp/notice-351886-images/attachment-0002.png --baseline-provider-response-path .tmp/ocr-compare-batch/20260412-round3/img-notice-contact-0002-retry/paddle/provider-response.jsonl --output-dir .tmp/ocr-compare-batch/20260412-phase16-validation/img-notice-contact-0002-mineru-candidate`
  - candidate `status=empty_output`
  - baseline `status=success`, `plain_text_length=2327`
  - adjudication `winner=baseline`, `reason_codes=["candidate_empty_output"]`

## Remaining Gap

- compare lane 已能产出 routing evidence，但还没有把这些 evidence 接到 canonical routing/fallback policy
- asset-class trigger、conditional canonical admission、以及 Paddle fallback boundary 仍待 `16-03`

## Next

- 执行 `16-03`
- 把 `16-02` 的 adjudication evidence 接成 provider-neutral routing policy 与 fallback 边界
