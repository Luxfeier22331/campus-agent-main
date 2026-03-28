# campus-agent v2

新一代 campus 入口 agent 的 monorepo。

## 先定架构

这个仓库正在围绕长期的 `supervisor-led hybrid orchestration` 架构重建。

- 文档索引与标识规则：`docs/README.md`
- 长期架构文档：`docs/architecture/long-term-architecture.md`
- `app-api` 架构文档：`docs/architecture/app-api-architecture.md`
- supervisor 专项架构：`docs/architecture/supervisor-architecture.md`
- 第一阶段数据平面架构：`docs/architecture/phase1-ingestion-and-storage-architecture.md`
- 编排与安全边界：`docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- 前向接受的 shared `apps/app-api` runtime 已冻结为 Worker；见 `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `apps/supervisor-api` 表示 execution engine boundary，不代表已经选定 FastAPI 或其他 runtime
- execution engine runtime 选择仍保持未冻结；当前实现取舍与 Agno 集成边界见 `docs/architecture/supervisor-architecture.md`

## 先看哪里

- 当前运行面、已开放 serving surface、当前优先级：`.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/STATE.md`
- 长期边界和冻结决策：`docs/architecture/`、`docs/decisions/`
- 环境配置 ownership 与模板索引：`docs/environment/README.md`
- 历史 phase 排期与存档：`.planning/ROADMAP.md`、`.planning/phases/`
- 当前 index / serving 术语：`docs/reference/runtime-serving-and-index-terms.md`

## 分支模型

- `develop` 是当前长期集成分支，也是根 worktree 默认检出的 merged truth
- `main` 是稳定分支，只通过 PR 接收已经在 `develop` 收口的改动
- 独立 feature / phase worktree 的进度，只有在合入 `develop` 后才能写成仓库当前 truth
- 历史上“某实现已合入 `main`”的记录继续保留，但不代表根 worktree 当前一定检出 `main`

## 当前仓库范围

- `apps/app-api`: 当前 `develop` 集成线只承载最小 typed projection seam；完整 Worker product backend 仍在独立 worktree 推进、尚未合入
- `apps/supervisor-api`: 入口 / supervisor 的对外服务边界
- `apps/ingestion-worker`: ingestion runtime 壳与离线任务入口
- `apps/public-entry-worker`: public entry Worker runtime 壳
- `apps/public-consumer-chat`: 已合入的历史 public chat app 实现参考，不再代表 forward Worker web surface truth
- `apps/protected-internal-panel`: 当前 internal panel shell / 历史迁移参考
- `packages/availability-specialist`: availability probe specialist 边界
- `packages/supervisor-core`: user goal 路由、委派和最终响应组装
- `packages/ingestion-core`: ingestion/data plane 逻辑消费层
- `packages/rag-specialist`: 知识域 specialist 入口
- `packages/retrieval-core`: retrieval 抽象和 evidence 获取引导层
- `packages/contracts`: 共享请求 / 响应与 delegation / handoff schema
- `packages/evals`: 评测辅助和 smoke 场景
- `packages/shared`: 轻量共享常量和工具

已接受的前向产品拓扑是 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`。但在当前 `develop` 集成线里，`apps/app-api` 仍只落地了最小 projection seam；更完整的 Worker 实现与 web-surface 接线仍以独立 worktree 进展为准，尚未合入这里的 merged truth。

## 当前基线

仓库已经从纯 bootstrap 进入可验证主链路收口阶段。

- 旧 bootstrap 已从工作树移除；如需追溯请查看 git 历史
- 当前主路径是 `supervisor-api -> supervisor-core -> rag-specialist -> retrieval-core`
- forward product topology 已接受为 `public-chat-web -> app-api -> supervisor-api` 与 `protected-panel-web -> app-api -> request projection`
- 当前 `develop` 集成线已落地 `apps/app-api` 的最小 Python projection seam，用于 canonical actor / profile memory / session summary 到共享 contract 的构造
- 更完整的 `apps/app-api` Worker runtime、auth/chat/operator API、projection data plane 与 web-surface 接线仍在独立 worktree 推进，待 merge 后再更新这里的当前基线描述
- 架构目标是 `supervisor-led hybrid orchestration`，而不是把 RAG 降级成顶层产品路径里的扁平 tool adapter
- ingestion/object-store/registry/retrieval 地基已落地
- 查询链路当前由 collection runtime profile 控制；当前 query-enabled surface 是 `regulations/student_handbook` 和 `curriculum/curriculum_plan`
- retrieval 当前读取固定 serving alias；离线 chunking / embedding / indexing 发布到 versioned physical collection，并通过 release manifest 保留可追溯元数据
- ingestion truth 统一为 `corpus + collection`；source 资产位于 `{source_channel}/{source_asset_slug}/{year}/{raw_version_id}/...`，并在同一来源前缀下按 `capture/`、`provider/`、`source-truth/` 分层保存，清洗后的文档存放在 derived bucket 的 `{corpus}/documents/{collection}/{title_slug}--{docid8}/{revision_track}/{year}/...`
- 对象存储不保留 chunk dump；chunk 文本、向量与检索 payload 只保留在 Qdrant，derived bucket 只保留 source/document artifact 与小型 index release manifest
- `campus_services/service_catalog` 与 `campus_services/contact_directory` 已作为离线 taxonomy 预留，当前保持 `offline_preparation`，不开放默认 query-serving；但它们同样走 release-managed alias + versioned physical collection
- `rag-specialist`、`supervisor-core`、`supervisor-api`、`evals` 已有可测试的当前 serving 入口
- `uv run --all-packages python -m unittest discover -s tests -t .` 当前通过，作为仓库级基线验证命令
- 运行态 buckets、live collection 重建证据、points count 与 benchmark 结果不在 README 维护；应以 `.planning/STATE.md`、`docs/runbooks/`、`docs/reference/` 和 `docs/policies/` 为准

## JS/TS Workspace

- Python workspace 继续以 `uv` 为准；不要把 `turbo` 当成 Python 主链路的替代
- JS/TS apps 现在通过 repo root `pnpm-workspace.yaml` 和 `turbo.json` 统一编排
- 当前纳入 workspace 的主要 app 是 `apps/public-consumer-chat` 与 `apps/public-entry-worker`
- repo root `package.json` 只提供 Turbo 代理脚本，不承载 app 级业务逻辑
- 日常全量验证使用 `pnpm web:typecheck`、`pnpm web:test`、`pnpm web:build`
- 面向 `develop` 的增量验证使用 `pnpm web:typecheck:affected`、`pnpm web:test:affected`、`pnpm web:build:affected` 或 `pnpm web:check:affected`

## 协作约定

- 提交标题默认使用 `Conventional Commit` 前缀加中文结果描述，例如：`feat: 完成 Phase 2A 工作流补全（resume/apply-choice + navigation_mode）`
- 详细工作协议与提交标题规则以根 `AGENTS.md` 为准

## 实现入口

- 当前地基实施基线：`docs/plans/agentic-rag-foundation.md`
- `app-api` 实施方案：`docs/plans/app-api-worker-foundation.md`
- 当前执行状态与当前 truth：`.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/STATE.md`
- 历史排期和 phase 存档：`.planning/ROADMAP.md`
- ingestion/data plane：`apps/ingestion-worker`、`packages/ingestion-core`
- retrieval kernel：`packages/retrieval-core`
- specialist / supervisor：`packages/rag-specialist`、`packages/supervisor-core`
- API shell：`apps/supervisor-api`
- baseline / smoke：`packages/evals`、`tests/`

## 本地验证

```bash
uv sync --all-packages --dev
uv run --all-packages python -m pytest tests/specialist/test_rag_specialist.py tests/supervisor/test_supervisor_core.py tests/api/test_supervisor_api.py tests/evals/test_golden_cases.py -q
uv run --all-packages python -m unittest discover -s tests -t .
pnpm install
pnpm web:typecheck
pnpm web:test
pnpm web:build
pnpm web:check:affected
```
