# Inspect Agent 评测

本包用 Inspect AI 执行离线结果评分。生产 Agent 不依赖本包，不经 Inspect model bridge 执行；Inspect `.eval` 日志是唯一离线结果，`report` 只是日志读取视图。

```bash
uv sync --package campus-inspect-eval
pnpm --dir packages/inspect-eval test:eval
uv run --package campus-inspect-eval campus-eval offline \
  --input result.json --log-dir var/eval/offline
uv run --package campus-inspect-eval inspect view --log-dir var/eval
uv run --package campus-inspect-eval campus-eval report var/eval/offline/example.eval
```

当前包只消费已保存的 Agent 执行结果。直接触发 Agent 执行的 Control/Runtime eval ingress 尚未接入；因此不需要用户 Cookie、评测 API token 或 App API 登录会话。后续 live solver 应直接连接执行层，不恢复 App API 产品准入适配。

默认只执行确定性 scorer；通过 `--grader <Inspect model name>` 显式启用语义评分，模型凭据使用 Inspect 的环境配置。grader 与生产模型配置独立。无 reference、缺少阶段正文或时间的维度明确未评分。

依赖声明不精确 pin；`uv.lock` 保持仓库一致解析。更新使用 `uv lock --upgrade-package inspect-ai`，然后执行本包检查。日志记录实际 Inspect 版本。
