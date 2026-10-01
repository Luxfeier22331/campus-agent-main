# Agent Note: 退役冗余 hash 计算

Status: implemented

本篇暂留 Campus Web 客户端 digest 校验的选择已由
[Campus Web hash 清理与运行态故障修复](../bug-fix/2026-10-01-campus-ui-hash-and-runtime-cleanup.md)
部分取代；其他领域的决策仍有效。

## 背景

项目历史上存在过度设计：对同一数据在多个环节重复计算或校验 hash、为无读者的字段计算 digest、
以及用硬编码常量跨语言重算服务端已下发的 hash。这些层层验证没有对应的信任边界或消费者，
属于历史遗留的防御性冗余，增加维护成本且在部分路径（如 notice 刷新）造成重复 I/O。

本次以"挑战所有 hash 计算"为目标，分四路对全仓做只读盘点，判定每处 hash 的真实消费者与
引入需求是否仍成立，仅删除判定为"无读者/同进程自检/为读一个字段而全量验证/纯写不读"的项；
核心的内容寻址身份（chunk ID、embedding set、附件 CAS、run 身份、invocation receipt、
primary_agent 冻结链路）因仍有真实读者与合同依据而全部保留。

## 决策

按产生→消费链路删除以下无依据的 hash 计算与校验：

- 在线 embedding fetcher 不再用硬编码常量重算 `TargetHash` 与服务端比对（逐字段校验保留）；
  删除已无调用方的 `createEmbeddingConnection`（`computeEmbeddingTargetSha256` 保留，
  本地 CLI/seed 依赖其生成与服务端一致的 target hash）；
- agent-runtime 删除 model-config 响应 `target_sha256` 二次比对（服务端 expected 不匹配时已 409）；
- notice embedding cache 消除双重读取：`resolveStoredNoticeEmbeddingCache` 返回已解析向量，
  `buildNoticeEmbeddingSet` 不再二次 GET+parse；删除三处同进程 `sha256(text)!==textSha256` 自检
  （输入 map 均由 `collectNoticeEmbeddingInputs` 以 `sha256(text)` 构造，无信任边界）；
- execution-control 投影 event payload 删除 9 个无生产读者的 `*_sha256` 字段及
  `admission_snapshot_sha256`/`tool_contract_fingerprint` 副本（`agent_run_events.payload_json`
  属 durable runtime 内部投影，非跨系统合同）；
- contracts 删除零调用的 `stableJson`/`sha256JsonRef` helper；
- internal-portal-collection 删除无消费者的返回 `etag` 字段；notice-publisher 删除
  derived 对象无读者的 `content-sha256` 元数据；
- notice 问题生成 manifest 删除无读者的 `broadSample.censusSha256`/`sampleSha256` 与
  `reviewCandidatesSha256`；
- 个人记忆命令终态结果退役 `result_fingerprint`（sha256(commandID+status+errorCode)）：
  裁决键在指纹之外已可得，hash 不携带额外信息。app-api 与 execution-control 两端同步停止
  发送/接收/存储/裁决比较，回调 payload、状态查询响应与 Temporal activity 输出不再携带该字段；
  幂等重放改为 status+errorCode 直比；
  `execution_control.personal_memory_command_receipts` 与 `profile.memory_commands` 的列
  由追加 migration 删除（baseline 不改）。

## 未纳入本次范围

- notice-artifacts-worker prepareRefresh 为读两个 manifest 字段而全量验证 embeddings.ndjson：
  属既有制品交互合同，非"无理由 hash"，留待后续单独评估；
- `retrieval_text_sha256` 必填要求（Qdrant payload 合同 + 历史索引兼容）：退役需 schema 版本迁移与
  索引重建，成本远高于无实际 bug 的字段保留；
- embedding cache 条目内 `modelTargetSha256` 字段：当前代码未重复校验，属元数据记录；
- `cleanupVersions` 全闭包重验、campus-web 客户端 digest 校验：防御性或成本极低，不属于本次删除目标。

## 未采用方案

- 一刀切删除所有内容 hash：核心的内容寻址身份（chunk ID、embedding set、附件 CAS、run 身份、
  invocation receipt、primary_agent 冻结链路）仍有真实读者与幂等/一致性需求，删除会破坏制品
  合同与持久执行语义，故全部保留；
- 两份 embedding fetcher 下沉共享包：C1 后只剩 25 行薄壳，package 内聚合 network fetcher 增加
  耦合而收益小，维持现状。

## 后续追加（同批收口）

- prepareRefresh manifest-only：`campus-rag-index-publisher` 新增 `readDocsEmbeddingSetManifest`/
  `readNoticeEmbeddingSetManifest`，复用 `readManifest` 只校验 digest+canonical+schema、不读数据体；
  `notice-artifacts-worker` prepareRefresh 换用（embedNotices 保持全量），消除最高频"无变化跳过"
  路径对两份 embeddings.ndjson 的全量读+逐字节 hash；
- 个人记忆命令 `result_fingerprint` 退役：见上文决策清单；
- notice artifact cleanup 单源化：两个 worker 下的同名 cleanup 副本（一个为全仓零引用的死代码）
  仅差 2 行；活实现下沉为 notice-index-publisher/cleanup（artifact key schema 的 owner），
  两份本地副本删除。

## 后果

embedding 缓存命中路径每条记录减少一次 S3 GET+parse；投影 payload 不再携带无读者 digest；
各在线消费方直接信任服务端下发的 `target_sha256`，跨语言重算这一漂移风险点被移除。
所有被删字段在删除前均经全仓 grep 确认零生产读者，删除不改变任何跨系统合同行为。
个人记忆命令终态链路少一次 sha256 计算与一列持久化状态；重放裁决语义不变
（同 commandID 下 status+errorCode 不一致仍报 fence conflict）。
