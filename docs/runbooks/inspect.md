---
doc_type: runbook
owner_boundary: packages/inspect-eval
status: active
---

# Inspect 评测

## 边界

本手册运行离线评分和结果查看。Inspect log 是唯一评测结果，生产 Agent 和 Langfuse 在线 trace 独立运行。旧 Ragas 分数已弃用，不导入也不重新命名为新指标。

当前 Inspect 包不触发产品请求，也不经过 App API；不需要用户 Cookie、`EVAL_API_TOKEN` 或 staging/dev 登录会话。Control/Runtime 的直接 eval ingress 接入后，live 执行另行增加专用入口。

## 操作步骤

从仓库根执行：

```bash
uv run --package campus-inspect-eval campus-eval offline \
  --input result.json --log-dir var/eval/offline

uv run --package campus-inspect-eval inspect view --log-dir var/eval
uv run --package campus-inspect-eval campus-eval report var/eval/offline/example.eval
```

默认只做确定性评分；增加 `--grader <provider/model>` 开启语义裁判。评分失败或输入缺失保留在 `.eval` 日志中，不通过自动产品重试覆盖原结果。

Inspect 的 `score` 命令用于对保存日志重新评分，不触发产品。`eval-retry` 只有在未来接入直接执行层的 live task 后才适用，当前离线 task 不会重新执行 Agent。

依赖更新使用 `uv lock --upgrade-package inspect-ai` 和本包检查。依赖声明没有精确 pin 或无依据上限；日志记录实际运行版本。

## 失败处理

- 输入缺失：相关维度未评分，不能默认为通过；
- 裁判格式或调用失败：记录评分错误，修正后只重新评分保存日志；
- 进程中断：保留 Inspect 日志，不读取生产原始恢复载荷。

## 相关文档

- [评测参考](../reference/eval.md)
- [用例](../reference/eval-cases.md)
