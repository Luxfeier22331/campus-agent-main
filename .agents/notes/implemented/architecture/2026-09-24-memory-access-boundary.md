# Agent Note: Personal memory access boundary

Status: implemented

## 背景

个人记忆管理读取此前直接使用 raw Hindsight reader，而 recall 和 append 使用带 fence 的执行器，
导致管理读取可能与 generation 排空并发。组合根在生命周期 state store 不可用时仍会暴露 provider，
同时 pause/resume 仅因 provider 不可用而被拒绝，尽管这两个转换只改变 runtime fence。

## 决策

Execution Control 组合根只有在 Hindsight provider 和个人记忆 state store 都可用时才暴露记忆能力。
带 fence 的执行器拥有管理读取、recall 和 append 的入口。原生的 list/get 管理读取在后续
[协调器合同](./2026-09-24-agent-memory-coordinator.md) 中被 profile 合成读取取代：owner 为
paused 时允许 profile 读取（kind `management_profile`），owner 为 draining 或 erased 时拒绝。
owner transition 由 state store 完成，不要求 Hindsight executor 可用。

## 未采用方案

不新增第二张 command 表，也不新增独立的管理读取 reconciler。既有 owner fence、lease 和 command
receipt 继续作为唯一运行时状态边界。

## 后果

管理读取参与 `GenerationDrained`，因此在读取进行时 erase 不能继续；该语义由 profile 读取继承。
state store 缺失会让整个记忆 runtime 对在线调用不可用，不再回退到没有 fence 的 provider。
provider 故障不再阻塞 pause/resume，但 erase 和记忆修改仍然需要 provider。命令恢复、排空上界和
profile 合成合同由[协调器合同](./2026-09-24-agent-memory-coordinator.md)承接。
