# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `apps/supervisor-agent-worker` 的局部规则。

## Role

这个 app 是 Python private semantic worker，不是 supervisor runtime owner。

- 接收 Go `apps/supervisor-api` 已规范化的 bridge envelope
- 执行 prompt runtime assembly 与 agent delegate dispatch
- 返回 `AgentResponse`，由 Go finalizer 生成 public supervisor response

## Boundaries

- 不在这里新增 capability keyword inference、lane inference 或 structured payload planner
- 不在这里发布 execution lifecycle / cancel counter / runtime truth
- 不在这里恢复 Python supervisor response finalizer
- bridge parser 只做 DTO 防御性校验；缺失 Go-owned decision 时 fail closed

## Module Rules

- bridge context 子结构应放在 `bridge_*_codecs.py`
- `bridge_v6_parser.py` 只做 envelope-level assembly，不直接手写 actor / authz /
  memory / session / trace 的展开逻辑
- 新增 bridge 字段先确认 Go bridge v6 projection owner，再补 Python codec parser

## Verification

优先使用这些命令验证本目录相关变更：

```bash
uv run --all-packages python -m unittest \
  tests.api.test_supervisor_api_bridge_server \
  tests.supervisor.test_supervisor_runtime_guardrails -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src
```
