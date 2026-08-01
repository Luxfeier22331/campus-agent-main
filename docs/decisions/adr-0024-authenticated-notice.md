---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0024
status: accepted
---
# ADR-0024 认证通知来源

## 背景

需要认证的校内门户与公开网站具有不同的身份、访问和采集语义。把两者视为同一来源会混合公开
抓取策略与依赖会话的内部采集。

## 决策

- 校内门户使用独立来源通道 `internal_portal`；
- `notice` 与 `file_release` 是两个独立来源类型；
- notice 固定采集类型 `5`（办公通知），页大小为 20，以门户和通知 ID 确定来源身份；正常增量
  不重复 ID，历史回填或失败重跑遇到已有 ID 时读取并校验对象，只复用与当前详情完全一致的内容，
  不覆盖已有对象；
- 门户内容不按登录主体变化，不在请求、产物、条目或发布流中引入登录主体作用域；
- notice 不使用固定历史起点。首次 `notice:sync` 只记录当前第一页的最大 ID，部署前已有通知不
  落桶；后续同步按 `totalCounts` 总条数分页，验证 ID 严格递减并准确遇到旧 head 后，只采集其前
  面的新 ID；
- 历史通知只通过 `notice:backfill -- --start-date YYYY-MM-DD` 显式采集；系统记录已采集的最小
  和最大 ID 以及成功覆盖到的最早日期，`notice:status` 直接展示这些边界；
- notice 只写 source bucket 的单条来源对象和 `_state.json` 边界，不创建采集请求、manifest、
  校验结果、document unit 或离线 release，也不写 derived bucket；
- file release 保持自己的来源合同，不转换为 notice；每个精确 ID 只写固定的原文件与
  `source.json`，不再增加物化和离线发布层；
- `apps/source-collector` 的 internal-portal 适配器负责供应商响应、规范来源块和附件引用；通知
  不下载附件字节，文件发布仍采集其明确请求的原文件；
- HTTP 适配器从原始 TGC 建立带 CookieJar 的会话。Service Ticket、`JSESSIONID` 和 `nginx`
  cookie 只存在于当前进程内存，不持久化会话状态；
- 应用会话失效时当前命令或 activity 直接失败，不自动重新建立会话或重放业务请求；
- 通知列表与详情、文件发布详情与原文件都使用 HTTP；source-collector 不自行获取、创建或改写
  TGC；
- CAS 跳转、Cookie 会话、TGC 校验和错误分类由不读取运行环境或存储的
  `packages/internal-portal-client` 统一实现；
- TGC 获取由采集器外部的人员认证流程完成。Ops Web 保存并验证多条具名 TGC，按需向开发者显示
  当前明文；本地通知命令从适配器未跟踪的 `.env` 读取开发者显式选择的
  `INTERNAL_PORTAL_SSO_TGC`；
- source-collector 不持久化或定期检查 TGC，Kubernetes ingestion base 也不注入 TGC；
- collector 不承担规范文档、OCR、规章物化、分块、索引或查询发布；
- 通知是 `source-collector` 的本地开发命令，不进入 Temporal、任务注册表或 Ops 控制面；文件
  发布按精确 ID 提交独立 workflow，但不成为 ingestion task；
- Ops Web 使用所属 PostgreSQL schema 保存原始 TGC 和有界检查 metadata；同镜像 Kubernetes
  CronJob 每分钟顺序建立门户会话，保存 CAS 刷新后的当前值，并以记录版本阻止旧检查覆盖轮换；
  该检查不进入 Temporal、不提交采集任务，也不控制通知同步。

## 结果

- 成功认证和采集不代表通知已经具备在线查询能力；
- 每个通知 ID 的来源对象和同步边界都保存在 source bucket；
- 文件发布只保存原文件与来源 metadata，workflow result 返回 `source.json` 引用；
- 认证凭据和检查状态由 Ops Web PostgreSQL 唯一保存；source-collector 本地检查不写状态；
- 下游规章、校历等领域必须通过自己的校验和发布入口消费通知来源。

## 相关文档

- `../architecture/domains/notices.md`
- `adr-0077-ingestion.md`
- `../architecture/system/data-plane.md`
- `../data/internal-portal.md`
