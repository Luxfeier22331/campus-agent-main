# campus-agent

`campus-agent` 是校园助理系统 v2 的入口 monorepo。产品不是通用聊天机器人，而是一个
institution-scoped、campus-web first、由 Execution Agent Layer 驱动的校园助理系统。

## 项目入口

- [当前架构](./docs/architecture/current.md)：已经合入 `main` 的实现事实；
- [产品边界](./docs/architecture/product.md)：产品提供和不提供什么；
- [目标架构](./docs/architecture/target.md)：长期必须满足的约束。

feature worktree 或未合并 branch 不是当前仓库事实。

## 公开仓库边界

公开仓库包含源码、合同、validator、公开文档、稳定的 self-authored 数据和 synthetic example。
它不发布 secret、私有部署状态、受限来源正文、采集页面、raw notice、生产数据库投影、当前
serving pointer 或运行时生成 artifact。

学校级数据不因“真实”而自动排除。项目自有且权利清楚、稳定、适合审查的数据可以进入仓库；
持续变化、受认证限制、体积较大或权利不明的数据进入 database、object storage 或对应 provider
system。完整规则见 [公开仓库数据策略](./docs/policies/public-source-data.md)。

public clone 使用 synthetic fixture。依赖 provider key、object storage、private database 或
content pack 的能力需要对应内部配置，不承诺在公开 clone 中直接运行。

安全与支持入口：

- [SECURITY.md](./SECURITY.md)
- [SUPPORT.md](./SUPPORT.md)
- [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)

## 目录

- [`apps/`](./apps/)：长驻 transport 与 runtime boundary；
- [`jobs/`](./jobs/)：定时或手动 deployable runtime；
- [`packages/`](./packages/)：稳定 domain、contract 与 reusable logic；
- [`configs/`](./configs/)：runtime、ingestion、source 与 reference-data 配置；
- [`infra/`](./infra/)：namespace-neutral 基础设施 source 与本地环境；
- [`scripts/`](./scripts/)：仓库入口命令与共享 deploy/env primitive；
- [`docs/`](./docs/)：architecture、decision、contract、data、runbook、policy 与 reference。

具体代码所有权见
[code-organization.md](./docs/architecture/system/code-organization.md) 和最近的 owner README。

## 文档

从 [docs/README.md](./docs/README.md) 查找所属文档；文档分类、中文规范、冲突裁决和删除规则见
[documentation-architecture.md](./docs/documentation-architecture.md)。

稳定规则：

- `docs/` 保存可重复引用的事实，不保存本轮工作状态；
- 已退役流程和旧设计通过 git history 追溯，不在 branch tip 维护 archive 副本；
- 一个窄能力优先只有一份人类可读文档，机器合同仍由 schema/OpenAPI 拥有。

协作规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)、
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) 与 [AGENTS.md](./AGENTS.md)。

## 开发

安装依赖：

```bash
uv sync --all-packages --dev
pnpm install
```

常用检查：

```bash
pnpm ci:repo
pnpm ci:typescript
pnpm ci:contracts
pnpm ci:go
pnpm ci:rust
pnpm ci:ingest
pnpm ci:eval
pnpm ci:worker
```

按改动 owner 选择最小通道；命令含义、integration/E2E 与 release 边界见
[测试与验证通道](./docs/reference/verification.md)。

`pnpm repo:static` 只检查通用格式与文本卫生；`pnpm docs:check` 检查 frontmatter、ADR 标识、
仓库内引用和中文正文。二者都不证明运行时、架构或 E2E 正确。

需要 shared database、provider、object store 或私有 content 的命令必须显式提供所属环境配置。
仓库不生成通用 env bundle，也不把 ignored `.env` / `.dev.vars` 在 worktree 之间复制。

## 协作

默认流程为：

```text
feature worktree -> pull request -> main
```

`main` 是稳定主干。release tag 与 GitHub Environment 选择生产 release，不使用长期开发分支
中转。未合并的计划和执行记录不作为默认分支的长期文档。

## 许可证

仓库自有源码、测试、配置和文档使用
[Apache License 2.0](./LICENSE)。第三方依赖、来源派生 fixture、地图数据、品牌资源和其他
artifact 仍受各自上游所有权与许可证约束；再分发前检查 [NOTICE](./NOTICE) 与
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
