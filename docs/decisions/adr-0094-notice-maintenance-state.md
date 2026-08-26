---
doc_type: decision
owner_boundary: domains/notices
status: accepted
decision_id: ADR-0094
partially_supersedes: ADR-0088
---

# ADR-0094 通知维护状态收敛

## 背景

通知来源、分类结果和规范化投影分别存在于对象存储与数据库，导致标题已经采集但数据库没有记录、分类
需要额外库存对账、人工维护无法直接作用于学生端权威状态。为解决通知后台编辑需求，不应再增加第二张
分类表、制品库存、安全清单或独立工作流。

## 决策

- 采集器在来源对象和资源齐备后登记 `notices.notices`，数据库从此拥有完整通知库存；
- `category` 可空并作为唯一分类权威；`unclassified` 是合法分类，不表示待分类；
- `is_published` 是唯一学生端可见边界，App API 只读取已发布通知；
- 状态由字段推导：空分类为待分类，已有分类且未发布为待发布，已发布为已发布；
- 通知采集维护状态使用 `internal_portal_notice_sync_state.v3` 的 [covered_from, covered_until) 半开区间；
  sync 只推进排他上界，backfill 只扩展包含下界，旧 v2 不推断缺失的上界；
- 门户闭区间日期参数只在适配器内部转换，详情发布时间负责最终范围校验；sync/backfill 使用固定
  PostgreSQL advisory lock 串行执行；
- 在线分类器从数据库读取 ID 与标题并写回分类；publisher 读取待发布项，写正文与资源后标记发布；
- Ops Web 的 `/notices` 页面读取安全 metadata、直接维护分类，并触发固定的一次性任务；
- 退役线上分类对象制品。离线 JSONL 只保留为模型比较输出，不进入发布链路；
- 不增加 revision、operator、append-only 历史、审批、恢复、override、自动串联或库存清单。

## 结果

通知只有一个库存和分类权威，人工修改与模型分类作用于同一记录。采集失败不会推进同步区间；默认批量
分类不会覆盖同时发生的人工修改。已发布通知修改分类后立即影响学生端，未发布通知仍需显式发布。

Job 诊断保留应用 Pod 输出中的原始错误与结构化进度，并把 Kubernetes controller condition 独立返回；
调试阶段不做错误码泛化、脱敏或截断。

对象存储中的旧分类对象不再被代码读取；其实际删除属于独立、不可逆的环境操作，必须在确认精确 bucket
与前缀后执行。
