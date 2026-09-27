# Agent Note: 采集阶段单通知数据错误隔离与输入合同分层

Status: implemented

## 背景

issue #548：`notice-runner.ts` 的 `writeCandidates` 逐通知循环中，除 `NoticeResourceTransferError`
（附件/图片传输）外，其余任何错误都中止整批。单条通知的 detail 缺失 `notice_info`、
source 构造失败（如 `notice_title` 缺失）、详情接口非认证性报错或库存登记数据冲突（conflict、
发布时间解析失败）会把整批采集挡在重跑循环里：失败通知永远排在前部，后续合法通知无法入库，
`covered_from/covered_until` 水位也无法推进。

issue #549：采集输入合同未分层——organization 映射（展示查询用）的字段缺失或重复与 notice type
映射（`allowedTypes` 过滤用）、分页完整性检查同属阻断性错误；列表项 `notice_type` 非法也中止整批，
但二者对采集正确性的影响完全不同。

## 决策

- 新增 `NoticeIngestionDataError`（`notice-ingestion-errors.ts`），携带 `noticeId` 与
  `operation: "detail" | "source" | "inventory"`；detail 获取的非认证错误、`notice_info` 缺失、
  source 构造错误与库存登记数据冲突都包装为该错误。
- `writeCandidates` 把每条候选的完整处理（detail 获取、source 构造、source/inventory 写入、
  资源下载）包进 try/catch：`NoticeResourceTransferError` 与 `NoticeIngestionDataError` 记入
  `NoticeRunnerFailure[]` 并继续下一条；其余错误（认证、对象存储、DB 连接）继续中止整批。
- `NoticeRunnerFailure` 的 `operation` 扩为 `"download" | "detail" | "source" | "inventory"`，
  `resourceKind`/`resourceOrdinal` 改为可选（仅 download 失败携带）；stderr JSON 序列化时
  undefined 字段自然省略，无合同破坏。
- 采集失败不改写 `processing_failures`：该表有 `notice_id REFERENCES notices.notices` 外键，而
  detail/source 失败发生时通知行尚不存在（行由库存登记插入）。提前插行会改变「通知行采集完成后即
  存在」的数据合同与状态机。失败摘要沿用任务级通道：`NoticeRunnerFailure[]` + stderr JSON +
  任务 summary 的 `noticesFailed`/`outcome: partial`。
- 认证错误（`PortalSessionExpiredError`、`PortalCredentialExpiredError`、
  `PortalCredentialUnavailableError`）在 detail 包装前 rethrow，保持「认证失败立即终止」的既有语义，
  由 runbook `portal-auth.md` 的 TGC 替换流程处理。
- 状态推进语义不变：任一通知失败（数据性或传输性）时不保存水位，清除失败后的重跑重新覆盖候选，
  幂等 register/put 保证重跑安全。
- 输入合同分层（#549）：列表项 `notice_type` 非法同样包装为 `NoticeIngestionDataError`
  （operation `item`），在 `scanNotices` 中逐项隔离计入同一失败通道；列表项 `notice_id` 非法保持
  整批中止——身份不可识别的项无法计入 per-notice 失败，也无法安全跳过（水位推进即永久漏采）。
- notice type 映射保持阻断：`allowedTypes` 来自该映射，空映射或字段非法会让全量通知被静默过滤，
  属于漏采防护；分页完整性（`total`/`totalCounts`/固定 `pageSize` 的 `Math.ceil` 关系）同样保持阻断。
- organization 映射降级为诊断：通知行的组织字段直接来自列表/详情，映射仅作展示查询；缺字段、
  重复或同名冲突的条目跳过并以 `noticeMetadata` JSON 日志记录（首个合法条目生效），不阻断批次。

## 未采用方案

- **`processing_failures` 增加 `ingestion` stage**：FK 约束要求 notice 行先存在；为记录失败先插
  半成品通知行会把失败数据写进 `notices` 状态机，扩大 `notices.notices` 合同。
- **提前 register 再补 detail**：同一问题，且 register 依赖 source 构造结果。
- **隔离所有错误类型**：认证与对象存储错误影响同批所有通知，隔离只会掩盖基础设施故障并让每条
  通知都失败一次。
- **列表项 `notice_type` 非法整批中止**：与未知合法 type 被过滤的行为不一致，且该失败可按
  notice_id 隔离重试，无需阻断同批其余通知。
- **organization 映射校验保持阻断**：该映射不被采集正确性引用，阻断只会让展示查询数据挡住通知
  入库；诊断日志已足够观察。
- **隔离非法 `notice_id` 项**：无 notice_id 无法构造失败记录也无法去重，跳过后水位推进等于
  永久漏采；保持整批中止是唯一安全行为。

## 后果

单条通知的数据性缺陷（detail/source/item/inventory）不再阻塞同批其余通知入库；水位仍在存在任何
失败时不推进，重跑在缺陷修复或门户数据修正后推进。organization 映射异常不再阻断批次，
以 `noticeMetadata` 诊断日志观察；notice type 映射、分页完整性与非法 `notice_id` 仍是阻断性检查。
runbook `ingestion.md` 与 `docs/data/notices.md` 已写入分层语义与采集失败不落
`processing_failures` 的原因。#549（metadata/分页分层）与 #550（publisher 逐条
提交）不依赖本次改动。
