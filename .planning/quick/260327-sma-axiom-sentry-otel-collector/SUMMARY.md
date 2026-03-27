# Quick Task 260327-sma

## Task

落盘 `Axiom + Sentry + OpenTelemetry Collector` 观测架构选择。

## Outcome

- 新增 `ADR-0010`，冻结 observability stack 的长期职责拆分
- 明确 `OpenTelemetry-first`、`Axiom for event analytics`、`Sentry for errors/traces/AI debugging`
- 明确 `OpenTelemetry Collector` 是 redaction、sampling 与 fan-out seam
- 在长期架构文档中收紧 observability / audit / tracing 的边界归属

## Notes

- 本 quick task 不实现 runtime 接入
- retention、alert threshold、sampling ratio 与 dashboard 仍留给后续实施阶段
