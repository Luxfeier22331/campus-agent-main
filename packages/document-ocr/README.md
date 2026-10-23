# Document OCR

PaddleOCR 官方 TypeScript SDK 的文档解析适配和 OCR 任务存储。
任务消费者是 `jobs/document-ocr` 与 Ops Web，通知索引源适配读取已有页面文本；不提取班车业务实体，不写入班次表。

本包不依赖通知领域，也不解析通知 HTML。通知领域的 `listNoticeSourceResources()` 提供来源资源引用，
Ops Web 和 OCR Job 各自选择正文图片与 PDF 附件并映射为 `OcrInput`，再交给本包管理任务和识别结果。
输入 JSON 中的 `noticeId` 用于任务展示及通知索引源读取；OCR 执行只按对象 key 读取字节。

- Provider 固定为 `paddleocr`，协议 `paddleocr.jobs`，模型 `PaddleOCR-VL-1.6`。
- 任务放在统一数据库的 `ocr.tasks`，DDL 由 `campus-agent-schema` 负责。
- 密钥只由 Model Config 加密保存，任务只记录目标、选项和配置更新时间。
- 原始 JSONL 与 Markdown 引用图片保存在 derived bucket 的 `ocr/tasks/<id>/`；页面正文和页序保存在
  数据库 `ocr.pages`。本地上传输入位于 `ocr/inputs/`。不保存供应商调试图片。
- 来源图片支持 JPEG/PNG，GIF 首帧及 BMP 转成 PNG 上传；摘要仍按原始字节计算。
- Markdown 保留 HTML 表格。Ops 使用已有人员认证、同源校验和安全 HTML 渲染。

## 异步行为

真实 PDF 识别超过 HTTP 请求窗口，因此任务必须保存供应商 jobId，供 Job 重启和 Ops 恢复。
这是 OCR 自身的状态，不是通用任务平台。提交前先持久化 `submitting`，收到 jobId 后保存
`submitted`；无 jobId 的中断结果未知，不自动再次上传。已有 jobId 只查询、下载；自有结果
已保存时可直接补回写，不依赖供应商结果 URL 仍有效。

输入引用去重不含配置版本：轮换密钥或更改连接不会重复识别历史文件。显式“重新识别”新建任务，
旧结果保留。任务和结果保留到业务主动清理；本次没有自动清理周期。将来改变供应商异步合同或不再
消费 OCR 时，需一并重新评估这张表和结果保留范围。

HTTP 请求和响应正文限时 60 秒，单任务等待窗口 10 分钟。窗口结束保留 jobId，下一次继续。
手动 Job 与 CronJob 使用同一个 PostgreSQL advisory lock；SDK 没有自动提交重试。

## 验证

```bash
pnpm test --filter=@campus-agent/document-ocr
pnpm --filter @campus-agent/document-ocr typecheck
# 当前 worktree 完成 document-ocr 的 dev:init 后执行，只操作测试创建的任务
pnpm --filter @campus-agent/document-ocr test:database-integration
```
