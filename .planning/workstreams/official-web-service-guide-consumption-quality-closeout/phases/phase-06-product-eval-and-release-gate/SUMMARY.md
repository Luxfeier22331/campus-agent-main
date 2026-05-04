---
doc_type: summary
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 6 Summary

## Delivered

- expanded default official-web selected-write preview runtime product cases in
  `packages/evals/src/campus_evals/official_web_selected_write_preview_runtime_verifier.py`
  with missing service-guide focuses:
  - `service-guide-campus-card-office-hours`
  - `service-guide-campus-card-eligibility`
- added eval regressions in
  `tests/evals/official_web_selected_write_preview_runtime_verifier_suite.py` to pin:
  - `guide_focus=office_hours`
  - `guide_focus=eligibility`
  - required body token expectations for each case
- kept existing deterministic thresholds for VPN grouped procedure and entry cases:
  - selected section count
  - required selected section ids
  - required tokens
  - forbidden unrelated tokens

## Product Coverage Status

The default preview/runtime verifier matrix now covers:

- `信息公开申请流程怎么办理`
- `信息公开申请入口在哪里`
- `信息公开联系电话是多少`
- `信息化办办公地点在哪里`
- `校园卡丢了怎么挂失，电话是多少`
- `校园卡在哪里补办`
- `校园卡补办办公时间是什么`
- `校园卡补办哪些人能办`
- `校园网认证入口在哪里`
- `校园邮箱需要什么材料`
- `VPN入口在哪里`
- `VPN客户端怎么安装`

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.official_web_selected_write_preview_runtime_verifier_suite -q
```
