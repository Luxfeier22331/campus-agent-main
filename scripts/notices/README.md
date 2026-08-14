# 内部门户通知分类试点

该脚本只读本地 RustFS 的 `campus-agent-source` bucket，把原始门户通知映射为唯一内部领域，并把
结果写到标准输出。它不修改来源对象，不写 derived bucket 或数据库，也不表示领域处理完成。

## 运行

先通过 `pnpm dev:init` 生成 source-collector 的本地对象存储配置，并确保本地 RustFS 已运行。
分类全部本地样本：

```bash
pnpm notice:classify
```

只分类指定通知时可以重复传入 `--notice-id`：

```bash
pnpm notice:classify --notice-id 123456 --notice-id 123457
```

脚本按 `notice_id` 升序输出 JSONL。整批全部成功后才写标准输出：

```json
{"notice_id":123456,"domain":"campus_operations"}
{"notice_id":123457,"domain":"admissions"}
```

## 分类

领域集合由 `@campus-agent/notices` 统一维护。确定性规则未命中时，模型从完整领域集合中选择。
门户类型名称从
`internal_portal/meta.json` 推导，不进入来源对象或输出。

正文只使用来源对象已有的门户 HTML，并在内存中转为纯文本。外链通知不抓取外部正文，也不把
`external_url` 传给模型。

模型调用固定使用 Responses API 的结构化输出。只有出现规则未命中的通知时才需要：

```text
INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY
INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL
INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL
```

缺少配置、模型调用失败或模型没有返回合法领域时，整批非零退出且不产生部分标准输出。

## 验证

```bash
pnpm exec tsx --test scripts/notices/*.test.ts
pnpm notice:classify:typecheck
pnpm exec biome check scripts/notices package.json
```

`golden/recent-notices.json` 固定试点样本的标题、门户类型、外链标记和期望领域，不保存外部正文或
消费状态。通知数据语义和人工确认后的发布步骤分别见 `docs/data/notices.md` 与
`docs/runbooks/ingestion.md`。
