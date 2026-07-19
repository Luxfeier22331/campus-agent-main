---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0082
status: accepted
---

# ADR-0082：Hindsight 记忆生命周期

## 背景

ADR-0058 选择 Hindsight 作为个人记忆运行时。产品仍需定义用户授权、并发隔离、来源删除和账号
清除，同时不能在仓库中重建 Hindsight 已有的提取、观测、合并和后台操作调度。

## 决策

- 产品数据库拥有用户授权、期望状态、用户可见记忆条目和待执行命令；Hindsight 拥有记忆物化；
- 命令和聊天请求在准入时冻结所需的生命周期、来源和用户代次，后续执行不能重读可变设置并
  改变本次请求语义；
- 每个用户代次使用独立 Hindsight bank。暂停保留当前 bank；账号清除递增代次、拒绝旧代次
  调用、等待在途调用结束、删除旧 bank 并验证其不存在；
- execution-control 只保存代次隔离、在途调用租约和幂等回执，不复制 Hindsight 记忆图；
- 同一账号的命令按产品顺序执行，后一条命令不能越过仍未完成的前一条命令；
- 浏览器只看到稳定产品标识和有限生命周期状态，不看到 Hindsight 内部标识。

## 来源与删除

每条已接受的用户消息对应可重复派生的来源文档，只发送该用户消息，助手输出不进入长期记忆。
会话裁剪或删除必须在删除产品记录前捕获来源身份，并从 Hindsight 删除同一来源；重复删除按
幂等成功处理。来源标识格式、批次和 API 参数由合同与实现维护。

## Hindsight 能力边界

- 使用 Hindsight 原生的提取、observations、consolidation、Memory Defense 和 bank 生命周期；
- recall 只向 Agent 提供有界且获准的记忆结果；
- 仓库不接收 Hindsight webhook，不轮询或代理其后台操作，也不建设第二套操作调度器；
- Hindsight 的后台恢复和模型调用属于其部署内部实现。

## Temporal 与终态

- Temporal 负责记忆调用的持久重试、取消、幂等和终态推进；
- 回答完成后的记忆追加失败不能回滚已经完成的回答；
- 账号清除必须持续推进到删除和验证完成，普通变更使用有界失败语义；
- 浏览器、模型和 Temporal Failure 只保存有限错误类别与公开消息，不序列化供应商原因、内部
  标识或原始载荷。

## 结果

仓库拥有产品交付、确定性来源生命周期和代次隔离；Hindsight 拥有记忆物化与内部后台工作。
仓库不为 Hindsight 配置 webhook 接收端或后台操作对账任务，也不增加重复其原生观测能力的
自定义抽取提示词。质量验证关注召回效果和来源删除结果。

## 参考

- <https://hindsight.vectorize.io/developer/api/retain>
- <https://hindsight.vectorize.io/developer/api/documents>
- <https://hindsight.vectorize.io/developer/api/operations>
- <https://hindsight.vectorize.io/developer/memory-defense>
- <https://docs.temporal.io/develop/go/activities>
