# Document OCR Job

站内通知正文图片与 PDF 附件的 OCR 消费者。本地和集群使用同一 TypeScript 实现与官方
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
pnpm --filter document-ocr ocr migrate-pages --dry-run
pnpm --filter document-ocr ocr migrate-pages
pnpm --filter document-ocr ocr cleanup-page-objects --dry-run
pnpm --filter document-ocr ocr cleanup-page-objects
```

路径参数相对于 Job 包目录，建议使用绝对路径。数据库和 derived bucket 使用当前 worktree 的
隔离资源，source bucket 使用当前 worktree 的独立实例；导入不改写来源对象。历史导入复用
`ocr/manifest.json` 的 42 份完成记录，下载必要图片但不重新提交识别；缺图会明确报告。
已完成任务再次导入直接跳过。导出目录按任务 ID 分隔，包含原始 JSONL、数据库中的 Markdown 正文和图片。

页面迁移命令不访问 Paddle 或 Model Config，必须在 schema `0008_ocr_pages` 应用后运行。
`migrate-pages` 把旧 Markdown 对象按原任务和页序写入数据库，保留旧引用供清理定位；
`cleanup-page-objects` 验证正文、页序和图片引用后，只删除旧 Markdown 对象并移除旧结果路径字段。
两条命令共用 OCR advisory lock，锁忙时失败而非报告迁移成功。`--dry-run` 只检查，不写库或删除对象。

已有环境切换时，先暂停 Ops 写入并等待旧 OCR Job 结束，再执行 schema 和页面迁移、部署新的 Ops/OCR
镜像，验收结果读取后运行清理。保持现有 CronJob 暂停配置；不要只手动缩容 Ops 而让 Argo CD 自愈恢复旧版本。
由 GitOps owner 协调目标应用的短暂维护窗口，Campus Web 和其他应用不停止。清理中断后可重跑清理命令；
迁移和清理都不重新识别，也不改变历史任务状态和时间。

运行配置来自 `MODEL_CONFIG_URL` 下的 `document_ocr`。数据库复用
`@campus-agent/notice-database` 的 PG/NOTICES_DATABASE 环境合同；对象存储使用
`OBJECT_STORE_ENDPOINT`、source/derived bucket 和各自访问凭据。集群先下载私有来源对象，再以
文件上传给 Paddle，不向外提供对象存储凭据或内部地址。

集群直连 Paddle 上行只有数 KB/s，GitOps 为 CronJob 注入 `HTTPS_PROXY`（campus-egress 连接器）和
`NODE_USE_ENV_PROXY=1`，Paddle 提交、轮询与结果下载经 sq-nixos 家宽出站；Model Config 和对象存储是集群内 HTTP，
不经代理。Ops 按 CronJob 模板创建的手动 Job 继承同一配置。出口拓扑见
[门户出口代理](../../.agents/notes/implemented/architecture/2026-10-22-portal-egress-proxy.md)。

## 自动扫描

`scan` 只选择检索会消费的资产：已发布、未下线的站内通知中，尚无任何 OCR 任务的正文图片与 PDF 附件。
发现先查数据库，只为这些通知读取已发布来源快照；已有任务（含失败）视为已覆盖，不自动重复计费，失败需显式 `rerun`。
`--since-days <n>` 只发现最近 n 天发布的通知，按发布时间从新到旧提交。`notice --notice <id>` 仍扫描该通知的
全部资源，分类和发布不是前提。
图片选择复用采集器的规范化规则，跳过编辑器占位图；`--pdf-only` 只扫描 PDF 附件，外链通知不参与。
JPEG/PNG 原样提交，GIF 取首帧、BMP 解码后转静态 PNG，原始来源对象保持不变。
任务按 source key 去重，展示序号单独保存，避免占位图清除后错配正文图片。

通知来源适配由 `@campus-agent/notices` 的 `listNoticeSourceResources()` 提供；本 Job 将资源引用映射为
OCR 输入，通用 `@campus-agent/document-ocr` 不依赖通知领域。构建保留外部 `jsdom`，由镜像的生产依赖提供。

每轮先恢复未完成任务，再处理新输入；扫描发现的新任务在同一轮内提交。`--max-submissions`（默认 10）限制每轮
新提交数，作为费用控制。
Paddle 返回 429 或「任务提交队列已满」时任务退回 pending，本轮停止新提交、只完成已受理任务；其他提交拒绝
标记为失败并需显式重跑。CronJob 每 15 分钟运行，`concurrencyPolicy: Forbid`，Job deadline 为一小时。
发布模板默认暂停；环境 overlay 负责启用调度和设置发现窗口与每轮上限。

## Ops 与交付

Ops 的模型配置页管理 OCR 连接；保存不联网验证、清空旧验证状态。验证接口立即返回 202 和
任务，Job 完成全文识别后才回写结果；回写按配置 `updated_at` 条件更新，旧密钥的结果不能覆盖
新配置。文档识别页提供列表、结果、按通知发起、恢复和重新识别；通知维护页支持逐图查看原图、状态、结果及单图识别。

OCR 调度独立于通知流水线。索引源组装在每次构建时读取已有识别文本，不等待 OCR，失败和未完成任务不阻断
通知进入 embedding；随后完成的识别文本在下一次构建中使用。详见
[正文图片独立消费](../../.agents/notes/implemented/feature/2026-10-02-notice-body-image-ocr.md)。

交付顺序：先应用统一 schema，再发布 Model Config、OCR 与 Ops 镜像，GitOps 选择真实 revision
与镜像 digest；保持 OCR 暂停，配置密钥、验证连接、导入已有结果、验收 staging，再启用 schedule。
启用 schedule 的前置是连接验证通过且 staging 验收完成；不在 production 启用调度。
