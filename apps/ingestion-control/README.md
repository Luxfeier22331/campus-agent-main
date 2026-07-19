# ingestion-control

离线采集任务的 HTTP 控制面和 Temporal Worker。

## 职责

- 校验任务引用并从注册表冻结执行信息；
- 为任务启动 Temporal workflow，并提供有界任务查询；
- 运行 workflow、控制 activity 和 Rust 内核桥接；
- 写入任务终态及 Official Web 最新抓取状态；
- 同步并维护内部门户认证状态检查的固定 Temporal Schedule。

来源请求、Crawlee、Playwright 和供应商凭据属于 `apps/source-collector`。确定性文件处理属于
`packages/ingestion-kernels-rs`。本应用不发布在线知识目标，也不通过 app-api 代理采集。

跨运行时字段由 `packages/ingestion-contracts` 维护，任务注册和执行器清单由
`configs/ingestion` 与运行时测试维护。

## 入口

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter ingestion-control schedules:sync
```

Dockerfile 提供 `api` 和 `worker` 两个 target。生产 API 使用普通 Deployment，Worker 使用
Temporal Worker Controller 管理的 `WorkerDeployment`；具体镜像和环境配置由环境仓选择。

## 验证

```bash
pnpm --filter ingestion-control typecheck
pnpm --filter ingestion-control test:ingest
```

## 相关文档

- `docs/architecture/system/data-plane.md`
- `docs/runbooks/ingestion.md`
- `docs/runbooks/portal-auth.md`
- `packages/ingestion-contracts/README.md`
