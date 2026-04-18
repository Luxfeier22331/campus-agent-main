---
doc_type: plan
status: active
created: 2026-04-18
updated: 2026-04-18
---

# Authenticated Notice File-Release Owner Recovery

## 文档边界

本文只负责一个问题：

- 如何把需要认证窗口的 `authenticated_notice_portal/file_release` capture、owner body recovery，以及它回接 `internal_notice -> regulations/institutional_regulations` 的 bounded downstream implementation 收口成独立 workstream

它回答的是：

- 当前 repo 已经具备哪些 `file_release` export / readiness truth
- `351119` 这类 auth-blocked regulation 为什么不该继续混在 non-auth downstream hardening 里
- 下一个 auth window 到来时，应按什么固定顺序完成 targeted capture、owner recovery 和 bounded rerun

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的 source-channel 边界
- `docs/reference/authenticated-notice-file-release-export-contract.md` 的 collector export contract
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md` 的 bounded readiness taxonomy
- `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md` 的 auth-window operator runbook
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md` 的 non-auth downstream hardening workstream

## 当前 Workstream 设计（2026-04-18）

这条线当前固定为一条单独的 auth-dependent workstream：

`auth-window targeted capture -> source-byte verification -> owner body recovery -> promotion/materialization re-entry -> bounded validation`

直接含义：

- 这条线只处理需要认证窗口才能拿到的 `file_release` truth，不再和已捕获 corpus 的 non-auth downstream hardening 混写
- 当前默认目标是 `351119` 的 bounded implementation slice，不默认扩成 full export、source-wide replay 或 collector foundation 重写
- `notice`、`file_release`、`regulation owner body` 继续保持三层分离；`file_release` 只能补 owner body，不覆盖 `internal_notice` source-truth
- 在用户未明确授权前，不进入 embedding、Qdrant、release、alias publish

当前这条 workstream 的单一入口固定就是本文；后续其他会话接手时，不再把 `auth:check`、targeted export、owner recovery consumer 和 bounded rerun 拆成多条并发 lane。

当前前向顺序固定为：

1. 按 `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md` 先做 `auth:check`
2. 对精确 `file_release_id` 做 targeted export，并确认 bundle / manifest / source locator 成功落盘
3. 用 bounded consumer 把目标 `file_release` 还原成可消费的 owner body source
4. 把 recovered owner body 回接到 promotion/materialization，而不是只停在 readiness
5. 只对目标 regulation 做 bounded rerun、target-side验证和 planning truth 回写

当前明确的第一条前向切片固定为：

- `351119 / 中央民族大学差旅费管理办法（民大校发〔2025〕104号）`
- 先 targeted `file_release` capture，再做 bounded owner recovery
- 不用 full export、历史全量 replay 或新的 collector 主线改造代替这一步

## 当前 Merged Truth

截至 2026-04-18，repo 内已经冻结的事实如下：

- `docs/reference/authenticated-notice-file-release-export-contract.md` 已冻结 `file_release` bundle / manifest 形状
- `docs/runbooks/authenticated-notice-file-release-auth-window-runbook.md` 已冻结 auth-window 里的 `auth:check -> targeted export -> optional bounded smoke -> optional full export` 顺序
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md` 已冻结 `ready / missing_capture / missing_source_bytes / ambiguous_match` readiness taxonomy
- `351119` 当前 blocker 已经明确：既缺 target `file_release` capture/source bytes，也缺 repo 内真正消费 recovered owner body 的 downstream consumer
- non-auth `authenticated-notice -> regulation downstream consumption` workstream 已经可以继续收口已捕获 corpus 的 admitted regulation / scoped_rules target truth，但它不应该继续承接 auth-window 任务

这意味着：

- 现在缺的不是新的 blocker 研究，而是把 auth-dependent implementation 从旧 workstream 中拆出来
- 当前最小正确动作不是 full export 或 collector 重写，而是针对 `351119` 完成一次 bounded capture + bounded consumer

## 当前非目标

- 不把 targeted export 偷换成 source-wide `file_release` inventory refresh
- 不在这条线里推进 OCR provider、chunk policy 泛化或 release/alias publish
- 不把 `file_release` 导出物伪装成 canonical `notice` source-truth
- 不把 collector、replay、promotion、materialization 再拆成多条并发 auth lane
