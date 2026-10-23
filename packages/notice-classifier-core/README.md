# notice-classifier-core

`packages/notice-classifier-core` 拥有内部通知标签（`category` + `intent`）的分类核心：规则车道、
判定文本、提示词与输出 schema、提供方协议、重试与并发。

负责：

- `lanes.ts`：按门户栏目分流的规则车道，标题信号明确时直接给出标签，否则返回 `null` 交给模型；
- `notice-judge.json` 与 `model.ts`：判定文本（版本号随口径修改递增）生成 LLM 的系统提示与 strict
  JSON schema，以及决策模型的 category、intent 两个 choice 问题；模型输入为标题与栏目名。决策模型没有提示
  缓存，类别定义与易混裁决中带 `title_signal` 的条款只在标题命中时发送，intent 判据发全文，LLM 系统提示始终
  按原顺序拼回全文。易混裁决（没有标题信号的每次都发，有信号的命中才发）只在 category 问题的 instructions
  里发一次，不按点名的类别复制；栏目说明只发本栏目的一条，输入说明不发给决策模型；
- `protocol.ts`：`openai.responses`、`openai.chat_completions` 与 `typesafe.systemone` 三种协议（System One 接口由 TypeSafe Jev 与
  Nace Drex 共用），输出统一为 `{ category, intent }`，置信度不参与判定；
- `classifyNotice` 重试：最多 3 次（间隔 15s/30s），无效输出与可重试提供方错误触发重试，
  `NoticeClassificationProviderError`（不可重试）直接抛出。

本包不读写数据库、不拥有 Job 编排和环境变量解析，唯一消费者是 `jobs/notice-classifier`。标签体系、
车道规则与判定文本的取舍见
`.agents/notes/proposed/feature/2026-10-21-notice-classification-redesign.md`。

```bash
pnpm --dir packages/notice-classifier-core typecheck
pnpm test --filter=notice-classifier-core
```
