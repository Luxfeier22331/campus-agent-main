# source-collector

用于来源采集的 Temporal Activity Worker。

## 所有权

当前处理四个注册任务：

- `official_web.capture`
- `internal_portal.notice.capture`
- `internal_portal.file_release.capture`
- `wechat_official_account.capture`

每个 activity 从对象存储读取带摘要的请求，通过所属适配器采集来源，写入来源产物和一个
结果 manifest，并返回 `ingestion_task_result.v1`。Crawlee、Playwright、浏览器状态、存储
句柄和供应商凭据都留在本应用边界内，不进入采集合同。

所有存储引用都包含摘要和字节数。写入采用 create-or-verify：新 key 条件创建，已有 key
只有在摘要与大小一致时才接受。按运行产生的抓取元数据、原始响应和结果 manifest 位于
`runs/<run-id>/attempts/<activity-attempt>/`；内容寻址的来源事实必须在重试间产生相同字节。

collector 不提供 HTTP 控制面，不调用 app-api，不维护 PostgreSQL run ledger，不启动
workflow，也不结束任务投影。Temporal 拥有重试、超时、心跳和取消；详细进度写入来源桶，
activity 只通过心跳上报有界摘要。取消必须传播到来源请求、Crawlee、浏览器和对象存储写入，
已取消 activity 不得写终态结果 manifest。

同一 worker 还提供非采集 activity，用固定 TGC 强制建立新的浏览器 SSO、门户会话并探测
一条通知。它只返回 Service Ticket、会话建立和探测结果，不写来源产物，也不把凭据或
供应商票据放入 Temporal 载荷。

## 运行

```bash
pnpm --filter source-collector start:temporal-worker
```

生产镜像包含 `configs/ingestion` 和 `configs/sources`，默认启动 Temporal worker，并通过
`infra/k8s/ingestion-runtime/base` 以版本化 `WorkerDeployment` 部署。镜像只安装 activity
需要的 Playwright Chromium headless shell，不包含 Firefox、WebKit、品牌 Chrome、包管理器
或开发依赖。交互式认证获取只在可信人员工作站执行，不是容器入口。

共享运行输入只有 ingestion Temporal 地址和来源对象存储凭据。供应商特有凭据只注入
source-collector。内部门户唯一外部凭据是 `INTERNAL_PORTAL_SSO_TGC_FILE` 指向的原始
TGC；Kubernetes 通过固定 Secret 完整卷投影该文件。适配器在本地运行目录派生并保存
`JSESSIONID`、`nginx` 和 Playwright storage state。旧的直接 Cookie 环境变量不再受支持。

```bash
docker build --target runtime -f apps/source-collector/Dockerfile -t source-collector .
```

## 验证

```bash
pnpm ci:ingest
```
