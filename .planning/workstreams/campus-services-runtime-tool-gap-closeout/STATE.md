---
doc_type: state
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# State: Campus Services Runtime Tool Gap Closeout

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no

## Captured Tool Gaps

### `service_status_lookup`

- subject alias 覆盖不足：自然说法需要稳定映射到 canonical service / subject
- status precedence regression 不足：临时调整、常规状态、历史记录、source conflict 需要固定
- `status_note` answer shaping 需要产品化
- public/chat source trace 与 observability 未闭环
- 缺真实入口 E2E gate

### `transport_schedule_lookup`

- route / direction / stop alias 覆盖不足
- 长期线路、临时线路、临时站点调整、schedule exception precedence 需要更完整 regression
- date / time semantics 需要收口：节假日、周末、寒暑假、下一班、projection window
- OCR / table extraction 质量仍是 backing projection 风险，runtime 只能 fail-close
- how-to / 预约说明应路由到 `service_guide_lookup`
- 缺最终 answer rendering + operational notices 摘要 E2E

### `service_guide_lookup`

- service guide catalog / alias 覆盖不足
- materials、entry、office hours、audience、contact refs 等 section normalization 需要加强
- 纯电话 / 邮箱查询应等待 `contact_directory_lookup`，不应长期压在 service guide 上
- 事务 guardrail 需要 E2E 验证
- source refs、更新时间、适用范围、clarification / unavailable 文案需要 product-path gate
- 高频 guide prompts 缺 public/chat E2E

### `contact_directory_lookup`

- alias 覆盖仍需扩展，尤其是学院办公室、招生咨询、国际交流科等自然说法
- ambiguous alias 需要稳定 clarification，不得默认猜测
- conflict / non-ready / restricted source 需要持续 fail-close
- 电话、邮箱、地点、办公时间的 answer shaping 与 source refs 需要 product-path gate
- action 请求必须保持 no-action guardrail，不生成打电话 / 发邮件 / 代联系 handoff

## Continuity Notes

- 不得通过 generic RAG 或 notice text search 顶替 structured tools。
- 不得让 runtime 在 query time 回扫 raw notice / handbook / portal HTML。
- 恢复时先补 deterministic tool denominator，再接 public/chat E2E。
