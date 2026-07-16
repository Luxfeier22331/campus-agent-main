---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---
# Worker 可观测性 Smoke

## 边界

本文验证已部署 Worker 的 OTLP 信号能够经过受保护的 Collector 进入当前配置的观测平台。
它不维护 Worker 清单、私有 hostname、dataset 名、release 快照、查询截图或 closeout 文件模板。

Collector pipeline、sink 和字段过滤见 `otel.md`；具体环境配置由环境
仓库与 Cloudflare secret store 拥有。

## 部署前检查

检查本地 Worker observability 输入：

```bash
pnpm exec tsx scripts/deploy/doctor-env.ts worker-observability-local --json
pnpm ci:worker
```

`doctor-env` 的 surface spec 是所需本地文件与 key 的事实来源。不要在 runbook 复制 key 清单，
也不要从 root `.env` 自动分发 secret 到多个 app。

这一步只证明配置形态和 Worker runtime test 通过，不证明外部观测平台已收到信号。

## 部署后检查

1. 从一个已部署 public surface 发起可识别但不含敏感正文的请求；
1. 记录 response 中的 trace/request correlation id 与 release；
1. 在 Collector health/metric 中确认 receiver 与 exporter 无持续失败；
1. 在当前配置的 trace sink 中按 correlation id 找到跨 surface/runtime 的相邻 span；
1. 在 log/metric sink 中确认相应低基数 event 或 metric；
1. 检查信号中没有 raw prompt、answer、transcript、retrieved body、cookie、authorization 或
   credential。

若当前环境未启用某个外部 sink，不把它当作必选通过项；以环境仓库声明的 Collector exporter
为准。不得为通过 smoke 临时把 Worker 改为直连 vendor API。

## 通过标准

- 请求本身成功，correlation id 能从入口关联到负责的 runtime；
- Collector 未丢失必需信号，也未绕过字段过滤链；
- 所有已启用 sink 至少能查询到本次请求对应的信号；
- metric label 保持低基数，不包含 request/user/document id；
- secret 与禁止正文未进入任一 sink。

## 失败处理

- 无入口信号：检查 Worker OTLP endpoint、auth 与 trace propagation；
- Collector 收到但 sink 缺失：检查 exporter credential、queue、retry 与 endpoint；
- correlation 断裂：检查 W3C trace context 在 Worker 与 private runtime 间的传递；
- 出现禁止字段：停止 fan-out，在 producer allowlist 与 Collector processor 两处修复后重测。

验收结果记录在所属 release/incident 中，不提交 `.tmp` artifact 或外部平台导出正文。
