# Replay fixtures

`personal_memory_erase_v1.json` 保存当前个人记忆删除 workflow 的合成 history，供离线 replay 验证当前
workflow contract 和预期 `succeeded` 终态。生成器直接运行生产 `PersonalMemoryCommandWorkflow`，
将宿主 worker identity 和 sticky queue 名称替换为固定测试值，不维护旧版本 workflow 或 marker 兼容逻辑。

`tool_execution_current.json` 来自真实 Node Runtime HTTP handler、生产 Go adapter 和 Temporal worker，
覆盖 Solve、Execute、Replan、Synthesize、成功 finalization 及 memory append。模型供应商边界和
post-answer memory append 使用受控测试实现；离线 replay 不会执行这些服务。

独立验证不启动 Dev Server 或 activity：

```bash
pnpm --dir apps/execution-control test:temporal-replay
```

需要有意更新受保护的历史时，在 `apps/execution-control` 下运行：

```bash
UPDATE_TEMPORAL_REPLAY_FIXTURES=1 go test -tags=temporal_integration ./integration/temporal \
  -run '^TestTemporalDevServerReplaysPersonalMemoryEraseHistory$' -count=1 -timeout=2m
UPDATE_TEMPORAL_REPLAY_FIXTURES=1 go test -tags=temporal_integration ./integration/temporal \
  -run '^TestProductionAgentRuntimeWorkflowContract$' -count=1 -timeout=2m
```

审查历史的变化后再运行独立 replay。普通正常 workflow 使用即时 replay，不为每个分支提交 history。
receipt 的完整输出恢复由 PostgreSQL integration 覆盖，不能用不执行 activity 的 history replay 替代。
