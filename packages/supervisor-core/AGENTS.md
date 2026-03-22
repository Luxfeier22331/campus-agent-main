# AGENTS.md

本文件补充根级 `AGENTS.md`，只描述 `packages/supervisor-core` 的局部规则。

## Role

这个目录是 `supervisor` 的唯一策略实现层。

- 负责用户目标路由、specialist 委派、结果组装、澄清升级和最小审计
- 第一阶段只允许路由一个 specialist：`rag-specialist`
- 当前实现仍是 bootstrap；目标是把当前的直接转调升级为真正的 coordination 层，而不是长期停留在透传包装

## Source Of Truth

修改本目录前，优先阅读：

- `../../AGENTS.md`
- `../../docs/architecture/2026-03-22-long-term-architecture.md`
- `../../docs/decisions/2026-03-22-phase1-architecture-decisions.md`
- `../../docs/plans/2026-03-22-agentic-rag-foundation.md`
- `src/campus_supervisor_core/__init__.py`
- `README.md`

## Owns

- 会话入口后的意图框定
- 选择委派给哪个 specialist
- 在置信度或范围不足时发起澄清
- 组合 specialist 结果并形成对外可消费的响应
- 最小审计字段收集与透传

第一阶段最小审计字段至少包括：

- `request_id`
- `trace_id`
- `user_id`
- `status`
- `source_doc_ids`

## Does Not Own

- retrieval 实现细节
- index 构建逻辑
- 向量数据库特定代码
- 对象存储、registry、Qdrant、MinIO 的直接接入
- HTTP transport、认证壳或 runtime 宿主逻辑

边界规则：

- `apps/supervisor-api` 负责 AgentOS/runtime 与外部 API 壳；不要把 transport/auth 设置回灌到这里
- `packages/rag-specialist` 负责 retrieval 导向的 specialist 逻辑；不要在这里越级实现 specialist 内部策略
- `packages/contracts` 是唯一共享 handoff/schema 边界；不要绕过 `DelegateToRagAgentRequest` / `DelegateToRagAgentResponse` 私自发明并行接口

## Phase-1 Constraints

- 默认只支持 `student_handbook`
- 不要在 supervisor 内扩大 corpus 范围
- 不要直接拼接对象存储逻辑
- 不要越过 specialist/retrieval 层访问 registry、Qdrant 或 MinIO
- 优先保持 `supervisor -> specialist` handoff 清晰，而不是引入快捷路径

## Coordination Over Pass-Through

- 不要把 supervisor 长期保留为对 specialist 的薄透传
- 如果新增逻辑，优先收敛成真正的 coordination 层，而不是继续叠加直连调用
- 不要把 transport、auth、retrieval 细节补进 supervisor 作为临时方案
- 如果问题来自 handoff 或 orchestration 边界错误，优先修 supervisor 的编排边界，不要靠外围适配层兜底

## Answering And Verification

- 涉及 agent orchestration、委派策略、runtime 能力边界、当前官方建议时，先联网核对官方资料
- 只在需要当前官方结论时联网；本目录本地代码事实不联网
- 不要在纯评审或纯判断回答后默认追加实现建议，除非当前结论依赖后续动作

## Subagent Guidance

这个目录鼓励把工作按职责拆开处理，但不要共享写集。

- 可以把 `response shaping`、`audit fields`、`tests` 拆成独立子任务
- 不要把最终路由规则、specialist 选择逻辑或接口取舍完全交给被委派的子任务；主代理保留最终编排责任
- 只有在 `contracts` 已冻结时，才并行推进 supervisor 内实现
- 若与 `packages/rag-specialist` 或 `packages/contracts` 同时改动，先切清写集再并行

## Verification

优先使用这些命令验证本目录相关变更：

```bash
pytest tests/supervisor/test_supervisor_core.py -q
python3 -m unittest discover -s tests -t .
```
