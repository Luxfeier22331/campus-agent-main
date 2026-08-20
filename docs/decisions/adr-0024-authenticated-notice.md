---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0024
status: accepted
partially_superseded_by:
  - ADR-0087
  - ADR-0089
---
# ADR-0024 认证通知来源

## 背景

需要认证的校内门户与公开网站具有不同的身份、访问和采集语义。把两者视为同一来源会混合公开
抓取策略与依赖会话的内部采集。

## 决策

- 校内门户使用独立来源通道 `internal_portal`；
- `notice` 与 `file_release` 是两个独立来源类型；
- 通知的采集范围、对象身份、同步边界、资源和分类交接由 ADR-0087 取代，当前数据合同见
  `../data/notices.md`；
- 门户内容不按登录主体变化，不在请求、产物、条目或发布流中引入登录主体作用域；
- file release 保持自己的来源合同，不转换为 notice；每个精确 ID 只写固定的原文件与
  `source.json`，不再增加物化和离线发布层；
- `jobs/internal-portal-collection` 的 internal-portal 适配器负责供应商响应与来源对象，文件发布仍采集
  其明确请求的原文件；
- HTTP 适配器从原始 TGC 建立带 CookieJar 的会话。Service Ticket、`JSESSIONID` 和 `nginx`
  cookie 只存在于当前进程内存，不持久化会话状态；
- 应用会话失效时当前命令或 Job 直接失败，不自动重新建立会话或重放业务请求；
- 通知列表与详情、文件发布详情与原文件都使用 HTTP；采集任务不自行获取、创建或改写 TGC；
- CAS 跳转、Cookie 会话、TGC 校验和错误分类由不读取运行环境或存储的
  `packages/internal-portal-client` 统一实现；
- TGC 的人员认证、持久化和轮换仍由采集器外部流程完成；采集消费时的凭据解析、本地拉取和 Job
  注入由 ADR-0089 取代；
- internal-portal-collection 不持久化或定期检查 TGC，Kubernetes ingestion base 也不注入 TGC Secret；
- 采集任务不承担规范文档、OCR、规章物化、分块、索引或查询发布；
- 通知和文件发布通过 `internal-portal-collection` 的同一本地 CLI 和一次性 Job 入口执行，不进入
  Temporal、任务注册表或 Ops 控制面；
- ingestion-control 使用所属 PostgreSQL schema 保存原始 TGC 和有界检查 metadata；同镜像 Kubernetes
  CronJob 每 30 分钟顺序建立门户会话，保存 CAS 可能返回的当前值，并以记录版本阻止旧检查覆盖
  轮换；该检查不保证延长 TGC 生命周期。凭据被明确拒绝后暂停定时检查，轮换或人工检查成功后
  恢复；依赖检查失败仍在下一周期重试。该检查不进入 Temporal、不提交采集任务，也不控制通知同步。

## 结果

- 成功认证和采集不代表通知已经具备在线查询能力；
- 每个通知 ID 的来源对象和同步边界都保存在 source bucket；
- 文件发布只保存原文件与来源 metadata；
- 认证凭据和检查状态由 ingestion-control PostgreSQL 唯一保存；本地认证检查不写状态；
- 下游规章、校历等领域必须通过自己的校验和发布入口消费通知来源。

## 相关文档

- `../architecture/domains/notices.md`
- `adr-0089-internal-portal-credential-resolution.md`
- `../architecture/system/data-plane.md`
- `../data/internal-portal.md`
- `../data/notices.md`
