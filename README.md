# campus-agent v2

新一代 campus 入口 agent 的 monorepo。

## 先定架构

这个仓库正在围绕长期的 supervisor + specialist 架构重建。

- 文档索引与标识规则：`docs/README.md`
- 长期架构文档：`docs/architecture/long-term-architecture.md`
- 第一阶段决策记录：`docs/decisions/adr-0001-phase1-architecture.md`
- `apps/supervisor-api` 表示对外 serving boundary，不代表已经选定 FastAPI 或其他 runtime
- runtime 选择要放在 contract 和 package 边界稳定之后

## 仓库范围

- `apps/supervisor-api`: 入口 / supervisor 的对外服务边界
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应和 handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

## 当前状态

仓库已经重置为 v2 架构基线。

- 旧 bootstrap 已从工作树移除；如需追溯请查看 git 历史
- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- 架构目标是 supervisor-led multi-agent orchestration，而不是 `RAG as a tool`
- 当前仍是初始化骨架，不是完整产品实现

## 本地验证

```bash
python3 -m unittest discover -s tests -t .
```
