# source-collector

内部门户来源采集 CLI。当前实现通知采集、通知资源采集和文件发布原始文件采集。

## 边界

Source Collector 使用直接传入或从 ingestion-control 解析得到的 TGC 建立门户会话，只写 source
bucket。它不持久化或定时检查凭据，不运行 Temporal worker，不维护任务投影，不清洗、分类或发布
通知，也不解析文件发布中的 PDF。

## 通知

```bash
pnpm dev:init
pnpm --filter source-collector auth:pull
pnpm --filter source-collector notice:sync
pnpm --filter source-collector notice:backfill --start-date YYYY-MM-DD
pnpm --filter source-collector notice:status
pnpm --filter source-collector notice:resources --dry-run --notice-id 123456
```

`sync` 和 `backfill` 采集通知 source、正文图片和附件。`notice:resources` 用于审计或补齐已有 source。
采集命令不写分类、规范化投影或用户状态，也不抓取外部正文。

## 文件发布

```bash
pnpm --filter source-collector file:sync
```

`file:sync` 分页列出门户文件发布库存，以固定并发 2 逐项采集。已有合法 `source.json` 时复用；普通单项
失败继续后续条目并最终返回非零，认证失败立即终止。每个 ID 只写原始 `file` 和
`internal_portal_file_release_source.v1` 的 `source.json`，不做 PDF 解析、OCR、清洗或分类。

源码同时提供 `file:sync:job` 和 `notice:sync:job`，它们先从 ingestion-control 解析可用 TGC，再调用
同一采集实现。当前 Kubernetes base 没有部署通知或文件采集 Job/CronJob。

## 认证

```bash
pnpm --filter source-collector auth:pull
pnpm --filter source-collector auth:check
```

`auth:pull` 从当前 Kubernetes context 的 `ops-web-internal-secrets` 读取既有
`OPS_WEB_INTERNAL_TOKEN`，临时 port-forward `service/ingestion-control:8000`，解析第一条可用 TGC 后
原子写入当前 worktree 受管理的 `.env.local`。本地开发和 Job 都不按凭据名称选择记录；采集会话获得的
新 TGC 只在本次进程使用，不写回。

## 验证

```bash
pnpm --filter source-collector typecheck
pnpm --filter source-collector test
```
