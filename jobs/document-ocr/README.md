# Document OCR Job

班车通知图片与 PDF 的 OCR 消费者。本地和集群使用同一 TypeScript 实现与官方
`@paddleocr/api-sdk@0.2.3`，不需要 Python、离线 OCR 镜像或额外识别服务。

## 配置与本地运行

先在当前 worktree 的未跟踪 `.env` 或进程环境提供
`DOCUMENT_OCR_BASE_URL=https://paddleocr.aistudio-app.com` 和 `DOCUMENT_OCR_API_KEY`。
初始化将密钥写入 Model Config 的加密字段，不调用 Paddle。

```bash
pnpm install
pnpm dev:init -- --target document-ocr
pnpm --filter model-config dev
# 另一个终端；每条命令读取 jobs/document-ocr/.env.local
pnpm --filter document-ocr ocr validate
pnpm --filter document-ocr ocr file --file /absolute/path/image.jpg
pnpm --filter document-ocr ocr notice --notice 245272
pnpm --filter document-ocr ocr scan
pnpm --filter document-ocr ocr resume --task <task-id>
pnpm --filter document-ocr ocr rerun --task <task-id>
pnpm --filter document-ocr ocr export --task <task-id> --directory /absolute/path/output
pnpm --filter document-ocr ocr import --manifest /absolute/path/collection/ocr/manifest.json
```

路径参数相对于 Job 包目录，建议使用绝对路径。数据库和 derived bucket 使用当前 worktree 的
隔离资源，source bucket 沿用现有本地采集共享桶；导入不改写共享来源。历史导入复用
`ocr/manifest.json` 的 42 份完成记录，下载必要图片但不重新提交识别；缺图会明确报告。
已完成任务再次导入直接跳过。导出目录按任务 ID 分隔，包含原始 JSONL、Markdown 和图片。

运行配置来自 `MODEL_CONFIG_URL` 下的 `document_ocr`。数据库复用
`@campus-agent/notice-database` 的 PG/NOTICES_DATABASE 环境合同；对象存储使用
`OBJECT_STORE_ENDPOINT`、source/derived bucket 和各自访问凭据。集群先下载私有来源对象，再以
文件上传给 Paddle，不向外提供对象存储凭据或内部地址。

## 自动扫描

扫描已采集的内部通知标题：班车、接驳、通勤、社会实践专车。分类和发布不是前提；
指定通知 ID 时不限制标题。图片选择复用采集器的规范化规则，附件仅处理 PDF，跳过 XLSX。

通知来源适配由 `@campus-agent/notices` 的 `listNoticeSourceResources()` 提供；本 Job 将资源引用映射为
OCR 输入，通用 `@campus-agent/document-ocr` 不依赖通知领域。构建保留外部 `jsdom`，由镜像的生产依赖提供。

每轮先恢复未完成任务，再处理新输入；单并发，最多提交 10 个新任务。CronJob 每 15 分钟运行，
`concurrencyPolicy: Forbid`，Job deadline 为一小时。发布模板默认暂停。

## Ops 与交付

Ops 的模型配置页管理 OCR 连接；保存不联网验证、清空旧验证状态。验证接口立即返回 202 和
任务，Job 完成全文识别后才回写结果；回写按配置 `updated_at` 条件更新，旧密钥的结果不能覆盖
新配置。文档识别页提供列表、结果、按通知发起、恢复和重新识别。

交付顺序：先应用统一 schema，再发布 Model Config、OCR 与 Ops 镜像，GitOps 选择真实 revision
与镜像 digest；保持 OCR 暂停，配置密钥、验证连接、导入已有结果、验收 staging，再启用 schedule。
供应商账户额度、输入限制与结果保留时间未确认前不启用自动扫描。当前实现不自动更新班车业务表，
不在 production 启用调度。
