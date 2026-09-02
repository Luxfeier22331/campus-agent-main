# campus-agent

`campus-agent` 是面向学校信息与校园服务的校园助手。它通过统一的学生产品提供问答、文档、地图、
食堂和账号功能，并以已发布的学校资料和校园服务作为回答依据。

## 项目入口

- [产品边界](./docs/architecture/product.md)：产品服务谁、提供什么和不提供什么；
- [架构入口](./docs/architecture/README.md)：按系统、领域和跨所有者流程定位当前实现；
- [目标架构](./docs/architecture/target.md)：长期架构约束；
- [文档索引](./docs/README.md)：架构、合同、数据、决策和操作手册。

## 公开仓库边界

仓库保存源码、合同、公开文档、可再分发的稳定数据和合成测试样例。Secret、私有部署状态、
受限来源正文、采集页面、生产数据库投影和运行时产物不得进入 Git。

学校级数据可以在权利清楚、稳定且适合公开审查时进入仓库；持续变化、需要认证、体积较大或
权利不明的数据进入所属数据库、对象存储或来源系统。详细规则见
[公开来源数据策略](./docs/policies/public-source-data.md)。

安全与支持入口：

- [安全策略](./SECURITY.md)
- [支持说明](./SUPPORT.md)
- [第三方内容](./THIRD_PARTY_NOTICES.md)

## 目录

- [`apps/`](./apps/)：常驻应用、Worker 和浏览器界面；
- [`jobs/`](./jobs/)：需要独立构建或调度的一次性、定时任务；
- [`packages/`](./packages/)：合同、领域逻辑和可复用库；
- [`configs/`](./configs/)：运行时和共享来源配置；采集重构配置暂在其独立边界内维护；
- [`infra/`](./infra/)：环境无关的基础设施配置和本地环境；
- [`scripts/`](./scripts/)：仓库级开发、验证、发布和本地辅助入口；
- [`docs/`](./docs/)：长期人类可读文档。

需要独立构建或调度的任务进入 `jobs/`；只服务仓库或本地操作的命令留在 `scripts/`。具体代码
所有权由最近的模块 README、合同和实现维护。

## 开发

```bash
uv sync --locked --all-packages --dev
pnpm install
pnpm check
```

根据改动范围选择所属模块检查。完整命令和适用范围见
[测试与验证](./docs/reference/verification.md)。需要数据库、供应商、对象存储或私有内容的命令
必须显式提供所属环境配置。

协作方式见 [贡献指南](./CONTRIBUTING.md)。

### Git hooks

在当前 checkout 或 linked worktree 执行 `pnpm install` 时，`prepare` 生命周期会自动调用标准
`prek install`，设置 worktree-local `core.hooksPath=.githooks`，并安装配置中声明的 Git hooks。
生成目录不提交 Git。使用 `--ignore-scripts` 安装依赖会主动跳过该生命周期；需要手动补装或修复
本地 hook 时执行：

```bash
pnpm hooks:install
```

`pnpm dev:init` 只初始化应用环境，不参与 Git hook 安装。CI、production install 和 Docker build
context 中由安装脚本跳过 Git hook。

先执行 `uv sync --locked --all-packages --dev`，使 Ruff、SQLFluff 和 Yamllint 可供 hook 使用。
`pre-commit` 对暂存文件执行 check-only 静态检查和 Secret 扫描；`pre-push` 对受影响的 Node 与 Go
模块执行类型检查和测试。两者都不替代 build、integration、浏览器 E2E、PR CI 或 runtime 验证。

## 许可证

仓库自有源码、测试、配置和文档使用 [Apache License 2.0](./LICENSE)。第三方依赖、来源派生
样例、地图数据和品牌资源仍受各自许可证约束；再分发前检查 [NOTICE](./NOTICE) 与
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
