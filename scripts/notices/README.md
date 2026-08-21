# 内部门户通知分类

该脚本是本地显式分类入口。它只读本地 RustFS 的 `campus-agent-source` bucket，把原始门户通知映射为
一个面向用户的通知分类，并把结果写到标准输出。它不修改来源对象，不写 derived bucket 或数据库，也
不表示通知已经发布或任一环境已经部署。在线一次性 Job 见 `jobs/notice-classifier/README.md`。

## 运行

先通过 `pnpm --filter internal-portal-collection dev:init` 生成内部门户采集任务的本地对象存储配置，并
确保本地 RustFS 已运行。
分类全部本地通知：

```bash
pnpm notice:classify --concurrency 2
```

只分类指定通知时可以重复传入 `--notice-id`：

```bash
pnpm notice:classify --concurrency 2 --notice-id 123456 --notice-id 123457
```

当前业务环境建议把 `INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL` 配置为
`deepseek-v4-flash-0731`，但源码不提供模型默认值或允许名单。每条通知都调用运行时选择的模型，默认
并发为 2；源对象读取和模型调用共享该并发上限。分类温度固定为 `0`，降低同一输入重复运行的随机
波动。脚本按 `notice_id` 升序输出 JSONL，整批全部成功后才写标准输出：

```json
{"notice_id":123456,"category":"campus_operations"}
{"notice_id":123457,"category":"admissions"}
```

## 分类合同

分类集合、中文名称和裁决规则由 `@campus-agent/notices` 统一维护。`category` 表示标题所表达的通知主要
用途，不依据运行日期或标题所述事项是否已过，同一标题的分类不会随时间变化。先区分办理、参与、
权威状态和可复用服务信息，与没有后续动作的纯叙事报道；军训记忆、社会实践启动、主题党日参访等纯
叙事内容归 `campus_news`。正式竞赛流程、业务办理和权威状态仍按对应分类处理。`unclassified` 只用于
标题不足以判断唯一分类的通知。

当前每条通知都调用模型，不启用标题规则。模型输入只有来源对象中的原始 `notice_title`；门户栏目、
正文、外链标记和 URL 均不作为分类证据。上述来源字段仍按各自数据合同保存和发布。

本地 JSONL 分类入口使用 Responses API 的结构化输出，运行时需要：

```text
INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY
INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL
INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL
```

每条通知最多尝试三次，重试间隔为 15 秒、30 秒。连接错误、HTTP 408、409、429、5xx，以及非法
JSON 或不符合单分类 schema 的输出参与同一重试预算；配置缺失、HTTP 400、401、403、404、422 和
其他本地合同错误立即失败。三次仍失败时整批非零退出且不产生部分标准输出，也不切换备用模型。
离线参考模型不会成为运行时 fallback；评估 manifest 会记录每次实际选择的模型。

## 业务验收

评估是手动、只读的本地验证通道，产物保存在被 Git 忽略的不可变目录。业务模型确定后使用新的 60 条
随机通知验收，不再要求已知边界和每次模型调用全部正确：

```bash
pnpm notice:classify:eval sample-random \
  --output-dir var/notices/eval/notice-category-final-acceptance-2026-08-16-v3 \
  --count 60 \
  --seed notice-category-final-acceptance-2026-08-16-v3 \
  --concurrency 2
pnpm notice:classify:eval label \
  --output-dir var/notices/eval/notice-category-final-acceptance-2026-08-16-v3 \
  --model gpt-5.6-sol \
  --concurrency 2
pnpm notice:classify:eval run \
  --output-dir var/notices/eval/notice-category-final-acceptance-2026-08-16-v3 \
  --model deepseek-v4-flash-0731 \
  --concurrency 2 \
  --stability-count 60
pnpm notice:classify:eval check \
  --output-dir var/notices/eval/notice-category-final-acceptance-2026-08-16-v3
```

`sample-random` 自动排除 `var/notices/eval` 下全部历史样本和仓库 badcase，按固定种子选择未见通知，
并绑定样本 SHA-256。`label --model` 选择的独立参考模型通过 Chat Completions、`temperature: 0` 生成
封存参考标签；`run --model` 选择的候选通过与本地 CLI 相同的 Responses 结构化输出路径运行三轮。两条命令
也可省略 `--model` 并读取 `INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL`，但参考模型与候选不能相同。
源码不维护候选模型允许名单、退役名单或业务模型常量。

业务验收门槛如下：第一轮和三轮合计与 Sol 的一致率均不低于 85%，三轮完全稳定率不低于 80%；
Sol 标签中支持数至少为 5 的分类，第一轮最低召回率不低于 60%；首次合法率不低于 98%，重试后合法率
必须为 100%。这些指标不是人工真值准确率，单条偶发分歧不阻塞；逐类塌缩或整体低于门槛才阻塞。

`label` 使用不可覆盖 checkpoint，持续限流后可以重跑同一命令补齐缺失标签。抽样、标签和候选运行在
网络调用前检查目标文件不存在，重新执行必须使用新目录，不能覆盖既有证据。`check` 只验证已封存的
样本、标签、预测和 manifest，并向标准输出写一行准入指标 JSON；它不生成报告文件，可以重复运行。

需要诊断库存类别分布时仍可运行 `stratify` 和 `sample`；`stratify` 通过重复的 `--model` 选择分层
模型，并在 manifest 中记录实际模型集合。平衡诊断使用 85% 随机一致率、0.80 Macro-F1、60% 最低
逐类召回和 70% 标题证据不足一致率，不作为本次业务验收的额外前置条件。样本只保存标题、通知 ID、
拆分和复核分组，不保存门户栏目、正文或外链状态。

## 边界失败样本

`golden/classification-badcases.sample.jsonl` 保存独立验收中发现的完整模型输入，
`golden/classification-badcases.json` 保存参考标签、Flash 三轮输出、裁决状态和边界说明；中文汇总见
`golden/classification-badcases.md`。仓库测试只校验 fixture 完整性和裁决状态，不访问模型 provider。

badcase 已参与问题分析，只用于后续提示词或模型候选的回归验证，不再作为独立盲测样本。存在
`needs_product_decision` 的记录时，应先完成产品边界裁决，再调整分类提示词；回归通过后仍需使用新的
未见样本独立验收。

## 验证

```bash
pnpm exec tsx --test scripts/notices/*.test.ts
pnpm notice:classify:typecheck
pnpm exec biome check scripts/notices package.json
```

通知数据语义和本地显式发布步骤分别见 `docs/data/notices.md` 与
`docs/runbooks/ingestion.md`。
