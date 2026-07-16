---
doc_type: runbook
owner_boundary: jobs/dining-sync
status: active
---

# 食堂数据同步

## 前置条件

- 目标数据库已经执行 app-api schema 安装；
- `dining-sync` 使用自己的数据库、飞书、对象存储和审核服务配置；
- 生产环境不使用 dev seed；
- Kubernetes 环境由环境仓提供 `dining-sync-config` 与 `dining-sync-secrets`。

## 完整同步

正式环境和需要同步目录及评价的环境执行：

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts sync-all
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

`sync-all` 已经包含目录刷新和发布，不要在它前面重复执行 `publish-catalog`。验证通过后，再从
真实产品入口检查 `/api/dining/halls`、一个楼层和一个评价接口。

## 有界重放

只需要从数据库中的有效目录观测重建发布快照时，不重新访问飞书：

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts publish-catalog-from-observations
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

只刷新来源观测而暂不发布时使用 `catalog-observations`。只同步评价时使用 `run`，但必须先有
有效目录观测。

## 本地测试数据

仅在非生产环境执行：

```bash
pnpm --dir jobs/dining-sync exec tsx src/cli.ts import-dev-seed
pnpm --dir jobs/dining-sync exec tsx src/cli.ts verify-published
```

dev seed 只验证仓库内平面图和界面，不代表真实食堂内容。

## 失败处理

- migration 或权限失败：先修复 app-api schema 安装，不由同步任务自动建表；
- 目录观测被阻止：修正飞书字段映射，不猜测食堂或档口关系；
- 评价审核或附件物化失败：不写学生评价读取模型；
- `verify-published` 失败：修复同步或发布步骤，不从草稿、fixture 或内存回退；
- 对象存储 URL 含飞书 token 或临时地址：拒绝发布并清理对应公开引用。

Kubernetes CronJob 运行 `sync-all`。镜像、周期、Secret 和数据库选择由环境仓维护；源码中的
base 不能证明任务已经部署或成功执行。
