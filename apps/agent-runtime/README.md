# agent-runtime

执行一次 OpenAI Agents SDK 运行的 TypeScript 服务。

## 职责

- 运行单一 Primary Agent 与本轮可用的可选函数工具循环；当前只可能开放
  `personal_memory_recall`；
- 消费 execution-control 提供的预期 Model Target hash、工具目录、上下文和截止时间，并从共同
  受信任的 Model Config 读取仍匹配该 hash 的 `primary_agent` 完整运行配置；
- 把工具调用交回 execution-control，不直接访问产品数据库或内部工具服务；
- 返回结构化终态、工具轨迹、模型用量和调用链关联信息；
- 通过 OpenTelemetry 与 Langfuse 记录受控 Agent 轨迹。

持久执行、重试、用户记忆获取、工具权限和运行终态属于 execution-control 与 Temporal。本应用不
保存会话或运行状态。

## 内部边界

- `agent-run-contract.ts` 拥有 SDK 运行输入输出合同，`terminal-envelope.ts` 拥有终态 envelope 的校验与
  规范化；
- `http-run-contract.ts` 负责 HTTP 请求校验与运行输入投影，`http-response.ts` 负责普通响应和 SSE
  wire 投影；Node server 不重复解释 Agent 终态；
- Provider、工具执行和 SDK runner 依赖上述 leaf contract，不反向依赖 HTTP server。

## 入口

```bash
pnpm --filter agent-runtime dev
pnpm --filter agent-runtime build
pnpm --filter agent-runtime typecheck
pnpm --filter agent-runtime test
```

## 相关文档

- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/tool-routing.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/reference/telemetry.md`
