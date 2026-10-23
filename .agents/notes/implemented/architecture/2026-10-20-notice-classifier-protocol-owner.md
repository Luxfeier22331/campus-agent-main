# Agent Note: 通知分类协议收敛到单一 owner

Status: implemented

## 背景

通知分类此前有三个各自独立的 provider 实现，各自维护"协议 → 请求体 → 解析成类别"的完整知识：

- `packages/notice-classifier-core/src/openai.ts`（后已删除）用 `openai` SDK 的 Responses 接口，配 `zodTextFormat` 结构化输出；
- `jobs/notice-classifier/src/model.ts` 用手写 fetch 同时支持 Responses 与 Chat Completions，自带一份 JSON Schema 字面量和两套响应文本抽取函数；
- `scripts/notices/eval-provider.ts`（后已删除）用 SDK 的 Chat Completions，不带结构化约束，另有一套宽松解析。

三处对"什么算合法输出"的判断并不一致：core 用 zod `.strict()` schema，评测侧用自写的单字段检查，生产 Job 用手写 schema 加两套抽取。新增一个协议需要在三个文件里分别实现，且任何一处改动都不会自动传导到另两处。

## 决策

`packages/notice-classifier-core/src/protocol.ts` 成为"协议 → 请求体 → 解析成 `NoticeCategory`"的唯一 owner，按 `protocol` 字段分派：

- `openai.responses`：SDK Responses 接口 + `zodTextFormat`；
- `openai.chat_completions`：SDK Chat Completions + JSON Schema 结构化输出。

三个消费者改为调用它，不再各自构造请求：

- `packages/notice-classifier-core/src/openai.ts` 退化为 env 配置解析与委托，保留 `createOpenAINoticeModelClassifier` 等既有导出（通知标签重设计后已删除，配置只由 `jobs/notice-classifier` 从 Model Config 读取）；
- `jobs/notice-classifier/src/model.ts` 删除手写 fetch、两套 payload、`CLASSIFICATION_SCHEMA`、`responseText`、`chatCompletionText`、`isRetryableStatus`，只保留 Model Config 的读取与校验，并新增 `openai` 依赖；
- `scripts/notices/eval-provider.ts` 删除 `parseExactClassification` 这第三套解析与裸 Chat 调用，改用 core 的协议入口。

`NoticeModelClassifier` 与 `NoticeModelClassifierWithRawResponse` 两个端口的定义从 `openai.ts` 移入 `classifier.ts`，与端口类型的所有权一致。协议配置接受可选的 `fetchImplementation`，供消费者注入测试替身；生产默认使用 `createNoticeModelFetch` 剥除网关拦截的 SDK 头。

判别合法输出的标准收敛为 `NoticeClassifierModelOutputSchema` 一处。评测侧原先允许的输入也一并收紧：Chat 路径现在同样发送结构化约束，不再依赖模型自行产出严格 JSON。

## 未采用方案

**在三处各自新增协议分支。** 改动量最小，但会在既有重复之上再加一层重复：每新增一个协议要在三个文件里分别实现，且三处对合法输出的判断继续分叉。

**新建独立的协议包。** 边界更清晰，但 `notice-classifier-core` 已经拥有端口类型、提示词、输出 schema 与错误类型，且生产 Job 已经单向依赖它。新建包需要重新建立同样的依赖关系并处理两者之间的类型重复，属于在既有 owner 之外引入第二个所有者。

**core 内部全部改用手写 fetch，移除 SDK 依赖。** 可统一三个消费者的依赖面，但需要自行实现响应抽取与错误映射，即重新引入本次删除的那部分代码。

## 后果

新增协议（例如决策模型的 `choice` 型结构化输出）只需在 `protocol.ts` 增加一个分派分支，三个消费者自动获得。三处对合法输出的判断不再可能分叉。

生产 Job 引入 `openai` 依赖，其构建走 esbuild `--bundle`，SDK 会被内联进单文件产物；同时必须使用共享的剥头 fetch，否则 SDK 自带的 `x-stainless-*` 头会被模型网关拦截。

协议名 `openai.responses` / `openai.chat_completions` 同时是运行配置里的 `api_protocol` 原值，协议字段不再从它做一次丢前缀的映射。

本次只做收敛，不改变 `classifier.ts` 的重试预算与端口形状，也不改变分类规则与类别描述的所有权。

## 后续：Jev 决策模型接入

这一段的分类语义（14 类选项、低置信 unclassified、规则揉进 criteria）已由[通知标签体系重设计](../../proposed/feature/2026-10-21-notice-classification-redesign.md)取代，代码仍是本段描述的状态。

同一 owner 在 `protocol.ts` 新增 `typesafe.systemone` 分支，消费 `decision-criteria.ts` 的决策规则；Model Config 放行 `typesafe` provider 与 `typesafe.systemone` 协议。决策分支用同一 OpenAI client 的 `client.post("/systemone", {body})`（保留超时、0 重试、剥头、错误分类），请求 `{model, state: {notice_title}, questions: {category: {type: choice, instructions, criteria}}}`，解析 `answers.category.choice`。

分类语义经实测收敛为：

- 决策模型选项集为 14 类，不含 `unclassified`（`NOTICE_DECISION_CATEGORIES`）；
- `unclassified` 从"可选类别"改为"低置信标记"：`confidence < 0.3` 时输出 `unclassified`（阈值经 101 条人工已验样本敏感性分析：0.3 时 99% 准确率，0.5 时把 4 条本可判对的标题误推给 unclassified）；
- 39 条裁决规则的双边信息揉进 14 段 criteria 描述，`instructions` 承载规则 1/2/3/4/5 总则；
- 正文不进分类依据：实测 61 条分歧中仅 52/300 有实质正文，加正文使真值从 10-11/11 降至 9/11，且合同规定只依据 `notice_title`。

评价：11 条 fixture 人工已验样本 3 次重复 11/11；101 条人工已验样本（11 fixture + 90 分层随机抽样、正文核对后逐条人工确认）3 次重复多数投票 99%（阈值 0.3），剩余错误全部是低置信触发的 `unclassified`，没有错分类。评测脚本与中间数据在 `scripts/notices` eval 与 `var/jev-eval/`（gitignore）；`scripts/notices` 已随通知标签重设计删除，评测改由 `jobs/notice-classifier` 的 `classify:eval` 承担。
