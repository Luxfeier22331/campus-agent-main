---
doc_type: requirements
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Requirements: Official Web Collection Restart Closeout

## Goal

恢复并记录 official web 本地采集路径的可重复闭环：从 `official_web` source-truth 输出 replay 到
canonical projection artifacts，并保留可追溯的 projection report、validation report 与当前 registry
truth 对照。

## Scope

- 本地 projection replay 与 projection validation 验证。
- projection document count 按 target collection 分桶。
- 当前 `.env` 指向的 registry official-web scope count 对照。
- projection artifact 路径、验证命令和当前缺口落盘。
- 后续 scheduler、preflight、retention、alert 与重复运行验收的 workstream 状态记录。

## Non-Goals

- 不开放 `fresh_news` 或 `news_archive` query-serving surface。
- 不改变 official web backlog opening 的 reopen rule。
- 不改写 official web control-plane owner。
- 不把本地 projection replay 写成 registry import、release 或线上部署完成。
- 不处理 authenticated notice、wechat official account 或 campus services runtime routing。

## Success Criteria

- projection replay 能生成 bounded official web documents。
- projection validation 中 `valid = true`、`errors = 0`。
- target collection count 能区分 `muc_public_pages`、`stable_reference`、`fresh_news` 与
  `news_archive`。
- registry count 对照明确当前是否已经 import/promote。
- 剩余 scheduler / preflight / retention / alert / repeated-run 缺口明确记录在 `STATE.md` 与
  `ROADMAP.md`。

## Acceptance Evidence

Latest accepted local projection evidence:

- projection replay:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-replay.json`
- projection validation:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-validation.json`
- projection output root:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/stable-5host-projection`

Latest accepted local outcome:

- emitted documents: `85`
- `muc_public_pages`: `75`
- `stable_reference`: `10`
- `fresh_news`: `0`
- `news_archive`: `0`
- validation valid: `true`
- validation errors: `0`
- validation warnings: `0`
- current `.env` document registry official-web records: `0`
- current `.env` raw asset registry official-web records: `0`
