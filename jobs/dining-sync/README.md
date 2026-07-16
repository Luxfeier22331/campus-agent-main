# 食堂同步任务

`jobs/dining-sync` 是食堂目录和评价的可部署写入任务。它从飞书读取来源记录，审核评价及
附件，并向 app-api 所有的 `dining.*` schema 发布学生读取快照。

## 边界

本任务负责：

- 同步食堂、档口和菜品目录来源观测；
- 从有效目录观测发布目录与当前快照；
- 同步、审核并物化评价图片；
- 写入评价读取模型；
- 验证当前已发布快照。

它不提供 HTTP 服务，不拥有学生页面、app-api schema migration、平面图 SVG 或运维网页。

## 命令

| 命令 | 作用 |
| --- | --- |
| `sync-all` | 刷新并发布目录，然后同步评价；Kubernetes CronJob 使用该命令 |
| `run` | 只同步评价，要求数据库已有有效目录观测 |
| `catalog-observations` | 只刷新目录来源观测，不发布 |
| `publish-catalog` | 从飞书刷新目录观测并发布 |
| `publish-catalog-from-observations` | 不访问飞书，只从数据库有效观测重新发布 |
| `import-dev-seed` | 仅在非生产环境导入仓库测试数据 |
| `verify-published` | 只读验证当前快照和评价图片引用 |

运行示例：

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts sync-all
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

## 配置

目录同步需要飞书应用、Base 和目录表配置；评价同步还需要评价表、对象存储和审核服务配置。
数据库连接使用 `DATABASE_URL` 或命令明确支持的 `APP_API_OPERATOR_DATABASE_URL`。完整变量
所有权见 `docs/environment/providers.md`。

任务不会自动发现或跨目录加载环境文件，也不会在缺少配置时回退到 dev seed。
生产环境禁止执行 `import-dev-seed`。

## 验证

```bash
pnpm --dir jobs/dining-sync typecheck
pnpm --dir jobs/dining-sync test
```

部署和数据收敛步骤见 `docs/runbooks/dining.md`；领域和数据规则见
`docs/architecture/domains/dining/architecture.md` 与 `docs/data/dining.md`。
