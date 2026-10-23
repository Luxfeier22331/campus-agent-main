# Agent Note: 传递依赖安全更新的覆盖范围

Status: implemented

## 背景

Dependabot 已确认 Node 与 Python 锁文件中的若干依赖存在漏洞。Miniflare 固定旧版 undici，
原 markdownlint-cli2 固定旧版 js-yaml 与 markdown-it，仅刷新锁文件无法升级这些依赖。
既有 brace-expansion 与 fast-uri override 的目标版本也已进入新的受影响范围。
安全更新后，用户要求继续更新已盘点的常规依赖，保留 Worker 的 Vitest 4 和 Node 24。

后续一轮（2026-10-20）将盘点范围扩大到全部依赖，用户的约束是"所有的依赖我们都应该考虑更新"。

## 决策

沿用 pnpm-workspace.yaml 作为 override 的唯一清单，更新既有安全版本约束。
对 Miniflare 的固定依赖使用限定上游的 override，保持其他消费者的版本选择。
markdownlint-cli2 升级后已直接使用安全的 js-yaml、markdown-it 和 smol-toml，删除相应临时覆盖。
上游不再请求受影响版本后删除对应覆盖，并核对依赖解析、frozen install 与漏洞扫描结果。
依赖范围已允许安全版本的 gRPC、ip-address、js-yaml 和 urllib3 直接更新锁文件，不新增 override。

本次按用户明确范围保留 RAGAS 及其 DiskCache 依赖，也不改变它们的扫描例外配置。

Cloudflare Vite 插件与 Wrangler 配套升级。Worker 测试池仍依赖 Vitest 4，其三个消费者
App API、Campus Web 和 Status Web 保持 Vitest 4；原 Vitest 5 消费者只更新本主版本。
Node 24.21.0 已是核对时的 24 系列最新版本，保留运行时锁定，Node 类型定义更新到 24 系列。

## 全量盘点的保留项（2026-10-20）

全部依赖更新后仍有 5 个包留在旧版本，均为有意保留，不是遗漏：

- `@langfuse/*` 停在 5.14.0。v6 移除 `api.trace`，`Trace` 只剩 delete/deleteMultiple，
  可读面只有 `api.observations.getMany`；而本仓 `request_id` 由 producer-side sanitizer
  写在 `langfuse.trace.metadata.*`，该 trace 级 metadata 在 v6 观察响应里没有对应字段。
  升级会使 `verify-trace` 无法完成[运行合同](../../../../docs/contracts/langfuse-runtime.md)
  要求的关联校验，需要先改 producer 把关联键落到观察级并复核合同。
- `@types/node` 停在 24.19.2。`.node-version` 锁定 Node 24.21.0，类型定义跟随运行时主版本，
  不升到 26。
- `braces` 3.0.3 无可用修复版本（`patched_versions: None`），且仅经 markdownlint-cli2 进入开发链路。

`@openai/agents` 曾按同批记录保留在 0.18.0（当时与 `openai` 同批升级导致锁文件解析出两份
`openai` 实例、`OpenAIProvider` 报 `exactOptionalPropertyTypes` 不兼容）。复核发现 0.18.0 与
0.20.0 的依赖合同完全一致（`openai: ^7.2.0`，peer/optional 相同），该冲突是既有锁文件上
增量解析的假象：先统一 `openai` 再升 agents 即解析为单份实例。已于同日升至 0.20.0 并通过
agent-runtime typecheck 与全部 296 个用例，保留项撤销。

## 未采用方案

全局覆盖 undici 能统一修复版本，但其范围与其他库的可选 peer 范围相交，可能将使用 undici 8
的解析改为 undici 7。当前受影响的固定版本来自 Miniflare，因此只覆盖该上游。
统一到 Vitest 5 可以减少测试框架版本数，但不符合当前 Worker 测试池的 peer 合同，也违反用户约束。
2026-10-20 迁移到 `@cloudflare/vitest-plugin`（peer 接受 `^4.1.0 || ^5.0.0`）后该约束消失，
vitest 已统一到 5.0.5，此条不再适用。
安全更新先采用兼容的传递依赖；用户授权常规更新后，再升级上游并删除已无必要的覆盖。

## 后果

固定旧依赖的开发和校验工具可以继续使用，受影响的传递依赖得到更新。临时覆盖仍需随上游版本
重新评估；锁文件更新和测试只能说明源码依赖状态，GitHub 告警关闭及部署结果由后续流程确认。
