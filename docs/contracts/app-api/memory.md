---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# App API 个人记忆接口

所有接口面向当前会话用户。app-api 持有生命周期和持久命令；记忆内容由 execution-control 从用户当前
generation 的 Hindsight bank 读取，不维护第二份手工条目投影。供应商不可用时内容查询返回错误，
不伪装为空列表；生命周期查询仍可用。

## 查询

- `GET /api/me/profile-memory` 返回
  `{profileMemory:{lifecycleState,syncStatus,operations}}`。
- `GET /api/me/profile-memory/items?q=...&kind=fact&state=active&limit=20&offset=0` 返回
  `{items,total,limit,offset}`。limit 为 1–100，offset 非负；kind 可选 fact/experience/summary，
  state 可选 active/inactive（默认 active）。q 是原生记忆文本搜索，不调用联网搜索。
- `GET /api/me/profile-memory/items/:memoryId` 返回 `{item}`。memoryId 是原生记忆 UUID，必须在
  当前用户 bank 中解析；不能凭 UUID 跨账号访问。

条目字段：memoryId、text、kind、state、origin、mentionedAt、editedAt。origin 为
manual/conversation/derived/unknown，不推测缺失来源。summary 详情还包含 sourceMemories。
列表覆盖手工添加及会话自动提取内容，不仅显示手工条目。

lifecycleState 为 active/paused/erasing/erased。syncStatus 为 synced/pending/failed，
**仅描述生命周期命令**，不因普通增改而禁用所有记忆。operations 返回尚未完成或当前失败的命令，
包含 commandId、commandKind、memoryId（新增或生命周期操作为 null）、status 和 errorCode。

## 修改

修改要求 8–200 字符的 `Idempotency-Key`，返回 HTTP 202：
`{profileMemory:{commandId,lifecycleState,syncStatus}}`。202 表示命令已接受，不是 Hindsight 完成。

| 操作 | 请求 |
| --- | --- |
| 添加自然语言记忆 | POST items，`{text}` |
| 编辑事实或经历 | PATCH items/:memoryId，`{text}` |
| 停用 / 恢复事实或经历 | PATCH items/:memoryId，`{state:"inactive"}` / `{state:"active"}` |
| 暂停 / 启用 | PATCH settings，`{enabled:false}` / `{enabled:true}` |
| 重试当前失败命令 | POST operations/:commandId/retry |
| 清除全部记忆 | DELETE /api/me/profile-memory |

text 去首尾空白、不得为空，保留正文内部格式。text 与 state 可以一起修改。summary 不可直接编辑；
界面展示支持事实，用户修改事实，由 Hindsight 更新派生观察。单条 DELETE 路由已移除。

停用映射 Hindsight invalidated，排除后续召回，但归档仍保存，可恢复；它不是物理删除。
暂停关闭后续 recall/append，允许管理已有内容。完整清除进入 erasing，隔离旧代次并等待在途调用、
删除旧 bank（包括来源、派生内容和停用归档），成功后保持 erased/关闭；不自动重新导入聊天历史。

重试只接受本账号当前代次、尚未被后续同目标操作替代的失败命令，创建新命令并保留原目标。
成功命令不保留正文；失败正文只供重试，完整清除时移除。命令回调唤醒下一条，
定时派发是补偿，不依赖用户打开页面。

## 生命周期与边界

- 删除或裁剪会话仅修改聊天数据，不触发记忆清理，也不承诺同步删除已提取记忆。
- 普通修改使用命令级状态，不拿命令序号作为聊天调用的版本条件。
- 全量清除与账号注销保留 generation fence、在途排空和终态处理。
- 个人记忆不能改变身份、授权或工具准入；默认 tenant 由服务端传递 tenant-main。
- 页面只有待处理命令时轮询状态；命令完成、提交成功、重新打开或回到页面时刷新内容。
  查询按用户和筛选条件隔离，切换账号清除旧缓存。

实现：`apps/app-api/src/modules/profile-memory/`、`apps/execution-control/internal/hindsightadapter/`、
`apps/campus-web/src/features/profile-memory/`。
