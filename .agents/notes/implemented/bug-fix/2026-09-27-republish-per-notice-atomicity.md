# Agent Note: republish 逐通知事务与 RAG 最终一致性

Status: implemented

## 背景

issue #550：`republishNotices` 预加载全部记录后使用单一 `BEGIN/COMMIT`，单条通知的 source 数据异常
（JSON 无效、合同违反、`notice_id` 不匹配）或资源投影冲突会回滚同批其余已成功的重物化；同时
republish 只改写 `notices.notices` 正文投影，页面与 AI 检索（chunk/embedding/serving collection）
之间的一致窗口没有成文合同。普通 publish 已按通知独立事务并隔离
`NoticePublicationDataError`（issue #548 批次前已存在），republish 与之不同构。

## 决策

- republish 改为逐通知事务：每条通知独立 `BEGIN/COMMIT`，事务内完成 `updatePublishedContent`、
  `insertOrVerifyAssets` 并清除该通知的 publication 失败记录，与 publish 路径同构。
- 单条 `NoticePublicationDataError` 记入 `notices.processing_failures`（stage `publication`，upsert）
  后继续下一条；数据库与对象存储等基础设施错误仍中止整批。CLI republish 摘要直接输出结果（新增
  `failed` 与 `outcome: partial`），不再硬编码 `outcome: "success"`；字段集合落在 ops-web
  `NoticeJobSummarySchema` 既有枚举内，无合同变更。
- 统计语义：`notices`/`assets`/`updated`/`unchanged` 只计成功提交的通知；`skipped` 保持
  「无正文且非显式 ID」跳过；显式 `--notice-id` 指定的通知无正文仍整批中止（操作者输入错误，
  不是数据缺陷）。
- RAG 一致性接受最终一致性（方案 A）：republish 不触发任何检索制品；正文变化由下一次
  `noticePipelineRun` 完整刷新收敛——`prepareRefresh` 从 `notices.notices` 重建 Chunk Run 并与激活
  Embedding Set 比对，未变化则跳过，变化则 embed 与统一发布。窗口与失败语义写入
  `docs/runbooks/ingestion/ingestion.md` 与 `docs/runbooks/ingestion/notice-indexing.md#与-republish-的一致性`。
- 自动 republish 批次不排除已有 publication 失败记录的通知：republish 本身就是重试入口，幂等写入
  （UPDATE 投影、`insertOrVerifyAssets` 先验证后插入、图片 derived 内容寻址
  `createDerivedAsset`、失败记录 upsert）保证重复尝试无副作用。

## 未采用方案

- **republish 接入 prepare/embed/activate**：为单条通知创建平行索引刷新路径，与 `noticePipelineRun`
  互斥执行 ID、版本目录（current/previous）和回滚合同冲突；检索刷新以整库 Chunk Run 为单位，
  单条刷新没有独立制品身份。
- **保留单一大事务**：单条数据缺陷回滚整批，重跑成本随批量增长，失败通知永久挡住后续通知的
  重物化。
- **自动 republish 批次排除 publication 失败通知**（与 publish 自动批次对齐）：会让失败通知失去
  自愈路径，需要显式逐条干预；publish 排除是因为其自动批次日常调度，republish 是显式维护操作。

## 后果

混合 republish 批次部分成功；失败通知在 `processing_failures` 可见、可显式重试，成功提交同事务清除
记录。页面正文与 AI 检索存在到下一次成功完整刷新的收敛窗口（Schedule 默认暂停时由运维手动触发
决定），已写入 runbook 合同。#553（runbook 与实际入口对齐）不依赖本次改动。
