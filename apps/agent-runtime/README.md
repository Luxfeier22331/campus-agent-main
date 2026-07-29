# agent-runtime

执行一次 OpenAI Agents SDK 运行的 TypeScript 服务。

## 职责

- 运行单一 Primary Agent 与本轮准入的可选函数工具循环；当前只可能按本轮授权开放
  `personal_memory_recall`；
- 消费 execution-control 提供的模型配置、工具目录、上下文和截止时间；
- 把工具调用交回 execution-control，不直接访问产品数据库或内部工具服务；
- 返回结构化终态、工具轨迹、模型用量和调用链关联信息；
- 通过 OpenTelemetry 与 Langfuse 记录受控 Agent 轨迹。

持久执行、重试、用户记忆获取、工具权限和运行终态属于 execution-control 与 Temporal。本应用不
保存会话或运行状态。

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
