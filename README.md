# campus-agent

`campus-agent` 是面向学校信息与校园服务的校园助手。它通过统一的学生产品提供问答、文档、地图、
食堂和账号功能，并以已发布的学校资料和校园服务作为回答依据。

## 项目入口

- [产品边界](./docs/architecture/product.md)：产品服务谁、提供什么和不提供什么；
- [当前架构](./docs/architecture/current.md)：已经合入 `main` 的系统与开放能力；
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
- [`jobs/`](./jobs/)：一次性或定时任务；
- [`packages/`](./packages/)：合同、领域逻辑和可复用库；
- [`configs/`](./configs/)：运行、采集、来源和参考数据配置；
- [`infra/`](./infra/)：环境无关的基础设施配置和本地环境；
- [`scripts/`](./scripts/)：仓库级开发、验证和发布入口；
- [`docs/`](./docs/)：长期人类可读文档。

代码所有权见 [代码组织](./docs/architecture/system/code-organization.md) 和最近的模块 README。

## 开发

```bash
uv sync --all-packages --dev
pnpm install
pnpm check
```

根据改动范围选择所属模块检查。完整命令和适用范围见
[测试与验证](./docs/reference/verification.md)。需要数据库、供应商、对象存储或私有内容的命令
必须显式提供所属环境配置。

协作方式见 [贡献指南](./CONTRIBUTING.md)，文档规则见
[文档规范](./docs/documentation-architecture.md)。

## 许可证

仓库自有源码、测试、配置和文档使用 [Apache License 2.0](./LICENSE)。第三方依赖、来源派生
样例、地图数据和品牌资源仍受各自许可证约束；再分发前检查 [NOTICE](./NOTICE) 与
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
