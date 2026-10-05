# 内部门户通知分类

本目录提供两条本地入口：`cli.ts` 读取 RustFS source bucket 中的通知并输出分类结果，`eval.ts` 提供只读的模型比较和回归诊断。两者都不写通知数据库、不修改来源对象，也不表示通知已经发布或任一环境已经部署。

在线一次性分类 Job 见 `jobs/notice-classifier/README.md`。

## 本地分类

在当前 worktree 运行 `pnpm dev:init -- --target internal-portal-collection` 生成 source bucket 的本地配置。该入口只读取来源对象；
在线数据库分类 Job 使用 `pnpm dev:init -- --target notice-classifier` 和 `pnpm --dir jobs/notice-classifier classify:local`。

source bucket 必须由 `OBJECT_STORE_BUCKET_SOURCE` 提供，读取当前 worktree 的 bucket，不限制固定桶名。

分类全部本地通知：

```bash
pnpm --dir scripts notice:classify --concurrency 2
```

只分类指定通知时可以重复传入 `--notice-id`：

```bash
pnpm --dir scripts notice:classify --concurrency 2 --notice-id 123456 --notice-id 123457
```

本地分类入口的模型由以下运行时配置提供：

```text
INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY
INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL
INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL
```

每条通知都调用配置的模型，默认并发为 2；源对象读取和模型调用共享该并发上限。分类温度固定为 `0`。脚本按 `notice_id` 升序输出 JSONL，整批全部成功后才写标准输出：

```json
{"notice_id":123456,"category":"campus_operations"}
{"notice_id":123457,"category":"admissions"}
```

## 分类合同

分类集合、中文名称和裁决规则由 `@campus-agent/notices` 统一维护。`category` 表示标题表达的通知主要用途，不依据运行日期或标题所述事项是否已过改变。同一标题的分类不会随时间变化。

分类先区分办理、参与、权威状态和可复用服务信息，再与没有后续动作的纯叙事报道区分。军训记忆、社会实践启动、主题党日参访等纯叙事内容归 `campus_news`；正式竞赛流程、业务办理和权威状态按对应分类处理。`unclassified` 只用于标题不足以判断唯一分类的通知。

当前每条通知都调用模型，不启用标题规则。模型输入只有来源对象中的原始 `notice_title`；门户栏目、正文、外链标记和 URL 均不作为分类证据。上述来源字段仍按各自数据合同保存和发布。

本地分类使用 Responses API 的结构化输出，模型调用最多尝试三次。连接错误、HTTP 408、409、429、5xx，以及非法 JSON 或不符合单分类 schema 的输出参与同一重试预算；配置缺失、HTTP 400、401、403、404、422 和其他本地合同错误立即失败。三次仍失败时整批非零退出且不产生部分标准输出，也不切换备用模型。

## 评测边界

`eval.ts` 是手动、只读的分析工具。它不写通知数据库，不生成线上模型配置，不自动选择模型，也不把任一指标变成部署门禁。动态证据保存在 Git 忽略的 `var/` 目录；仓库只保存评测代码、说明和已经完成产品裁决的 regression fixture。

评测名称具有以下固定含义：

- `label-gold`：当前比较使用的参照标签，可以直接修改；修改后重新执行 `check`，不重新调用模型。它不是人工真值，不能写成 accuracy。
- `label-gold-predictions`：生成初始 `label-gold` 时保存的原始 Chat Completions 结果。它记录来源证据，但不限制后续产品修正 `label-gold`。
- `candidate prediction`：待观察模型通过与生产分类入口相同的 Responses、提示词和结构化输出合同生成的结果。多个模型的结果相互独立，不产生全局通过或自动选模结论。
- `product_expected_category`：产品已经裁决的预期类别，只存在于 regression fixture。它是 regression 一致性分析的目标，不与 `label-gold` 混用。
- `repeat`：一次独立分类任务。默认只运行 `repeat: 1`；只有显式提供稳定性 ID 文件时，所列通知才会再运行 `repeat: 2` 和 `repeat: 3`。

所有需要模型的命令都必须显式传入 `--model`，不会从 `INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL` 回退，也不会切换 provider、网关或备用模型。
评测中的每个任务只调用模型一次；生产分类 Job 的三次重试合同由生产分类入口单独维护，不进入模型质量诊断。

## 样本与运行

随机诊断样本只排除调用者通过 `--exclude-ids` 或 `--exclude-file` 明确提供的通知，不扫描 `var/`、regression fixture 或其他历史目录：

```bash
pnpm --dir scripts notice:classify:eval sample-random \
  --output-dir var/notices/eval/notice-category-diagnostic-2026-08-27-v1 \
  --count 60 \
  --seed notice-category-diagnostic-2026-08-27-v1 \
  --exclude-file var/notices/eval/previous-sample.jsonl \
  --concurrency 2

pnpm --dir scripts notice:classify:eval generate-label-gold \
  --output-dir var/notices/eval/notice-category-diagnostic-2026-08-27-v1 \
  --model gpt-5.6-sol \
  --concurrency 2

pnpm --dir scripts notice:classify:eval evaluate-candidates \
  --output-dir var/notices/eval/notice-category-diagnostic-2026-08-27-v1 \
  --model gpt-5.6-luna \
  --model deepseek-v4-flash-0731 \
  --concurrency 2

pnpm --dir scripts notice:classify:eval check \
  --kind candidate \
  --output-dir var/notices/eval/notice-category-diagnostic-2026-08-27-v1
```

需要观察重复一致性时，先人工确定 ID 并保存为 JSON 数组，再显式传入：

```bash
pnpm --dir scripts notice:classify:eval evaluate-candidates \
  --output-dir var/notices/eval/notice-category-diagnostic-2026-08-27-v2 \
  --model gpt-5.6-luna \
  --model deepseek-v4-flash-0731 \
  --stability-ids-file var/notices/eval/stability-ids-2026-08-27.json \
  --concurrency 2
```

随机样本是默认诊断入口。只有明确研究模型共识、分歧或类别覆盖时才运行模型分层，并显式选择样本配额：

```bash
pnpm --dir scripts notice:classify:eval stratify \
  --output-dir var/notices/eval/notice-category-stratified-2026-08-27-v1 \
  --model gpt-5.6-luna \
  --model deepseek-v4-flash-0731 \
  --concurrency 2

pnpm --dir scripts notice:classify:eval sample \
  --output-dir var/notices/eval/notice-category-stratified-2026-08-27-v1 \
  --random-count 60 \
  --category-count 4 \
  --seed notice-category-stratified-2026-08-27-v1
```

`sample` 只读取 `strata-predictions.jsonl` 中实际出现的通知 ID，再从当前来源加载这些标题；来源新增其他通知不会使已经保存的 sample 自动失效。sample 文件本身是后续比较的输入。

`generate-label-gold` 使用 Chat Completions 和 `temperature: 0`，每条通知调用一次。命令保存完整 prediction；全部得到合法分类后才更新 `label-gold.jsonl`。显式重跑生成、候选或抽样命令会更新对应当前文件，不需要新目录、checkpoint 或不可变 manifest。

## 错误与指标

每次调用只会得到以下三种结果之一：

- `ok`：收到并解析出合同内的单一类别；
- `invalid_output`：provider 已返回内容，但内容不是合法的单分类输出；记录完整 `raw_response` 和 Error stack/cause；
- `provider_error`：没有得到可供模型输出校验的响应；记录完整 provider Error stack/cause。

其他 `TypeError`、配置错误或本地合同错误属于评测程序自身失败，直接抛出，不能改写成 `invalid_output`。评测不重试 provider error 或非法模型输出；需要验证生产重试时使用生产分类入口及其所属测试。

报告始终给出计数和分母：

- `outcomes.response_valid_rate = ok_count / response_received_count`，其中 `response_received_count = ok_count + invalid_output_count`；provider error 不进入模型输出合法率分母。
- `outcomes.provider_error_rate = provider_error_count / total_task_count`。
- 与 `label-gold` 或 `product_expected_category` 的 agreement 只在合法模型输出上计算，并同时输出 `scoreable`、`invalid_output_count` 和 `provider_error_count`。
- 重复一致性只计算显式稳定性样本中三个 repeat 均得到合法输出的记录，未完成记录单独计数。

评测预测和报告不记录 token usage；缺少供应商 usage 时不会用 `0` 代替未知值。成功预测仍保存完整
`raw_response`，非法输出保存 provider 返回的原始文本，provider error 不携带模型响应。

`check --kind candidate` 和 `check --kind regression` 只读取当前 sample、标签、prediction 和显式 stability IDs，验证任务覆盖并计算上述结果，不调用模型。存在 provider error 时输出 `evidence_status: "partial"` 并非零退出；模型分歧或非法输出仍作为分析数据输出，不产生质量 `passes` 字段。

## 评测产物

一个评测目录可能包含：

- `strata-predictions.jsonl`：显式模型分层结果；
- `sample.jsonl`：当前诊断样本；
- `label-gold.jsonl`：当前比较标签；
- `label-gold-predictions.jsonl`：初始标签的原始模型生成证据；
- `candidate-predictions.jsonl`、`stability-ids.json`：Responses 候选结果和显式稳定性集合；
- `regression-predictions.jsonl`、`stability-ids.json`：产品裁决回归集的 Responses 结果和可选稳定性集合。

旧 `var/` 目录中的 manifest、hash 和 checkpoint 不再被当前命令读取，也不需要迁移。历史 prediction 若缺少成功响应的
`raw_response` 不满足当前检查合同；不要手工补写证据，重新运行对应 eval。需要保留历史运行时直接保留目录；需要按当前标签重算时运行 `check`。

## Regression case

`regression/classification-badcases.json` 是回归 case 的唯一输入，每条记录同时保存完整标题、
`product_expected_category`、边界分组和产品裁决理由。评测入口直接从这些 case 派生 `regression` sample，
fixture 不保存历史 `label-gold`、候选输出或失败模式。

```bash
pnpm --dir scripts notice:classify:eval evaluate-regression \
  --output-dir var/notices/eval/notice-classification-regression-2026-08-27-v1 \
  --model gpt-5.6-luna \
  --model deepseek-v4-flash-0731 \
  --concurrency 2

pnpm --dir scripts notice:classify:eval check \
  --kind regression \
  --output-dir var/notices/eval/notice-classification-regression-2026-08-27-v1
```

默认每条 case、每个模型只执行一次。需要稳定性实验时显式传入只包含 regression notice ID 的 `--stability-ids-file`；只有这些 case 执行三个 repeat。输出分别展示模型与产品预期分类的一致性、有效响应、provider error 和可选重复一致性，不生成全局通过结论；回归集也不能替代新样本上的独立诊断。

## 验证

```bash
pnpm exec tsx --test scripts/notices/*.test.ts
pnpm --dir scripts typecheck:notices
pnpm exec biome check scripts/notices package.json
```

通知数据语义和本地显式发布步骤分别见 `docs/data/notices.md` 与 `docs/runbooks/ingestion/ingestion.md`。
