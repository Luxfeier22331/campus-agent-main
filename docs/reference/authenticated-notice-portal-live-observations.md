---
doc_type: reference
status: active
created: 2026-04-09
updated: 2026-04-09
---

# Authenticated Notice Portal Live Observations

## 文档边界

本文记录 `authenticated_notice_portal` 在 live 登录态下已经确认的栏目与样本事实，用来收口：

- collector live notice-type policy 应如何解读
- portal `notice_type` 为什么只能作为 coarse prior
- `rag-data` historical donor intake 应如何与 live collector 执行面分开

它不替代：

- `docs/architecture/authenticated-notice-source-architecture.md` 的 repo-level source-channel architecture
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md` 的 notice-family decision
- `configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json` 的实际 family rule config

## 观测基线

2026-04-09 已确认以下 live 事实：

- 新 cookie 导出的 runtime `storageState.json` 可以访问 `https://my.muc.edu.cn/page/11#/`
- repo-local collector `auth:check` 已成功返回 notice list 样本
- repo-local collector 当前 tracked 默认 notice-type config 只启用：
  - `5 / 办公通知`

## Live Auth Artifact Observations

2026-04-09 对 runtime `storageState.json` 做了最小 cookie 组合探针，结论固定为：

- 对 `authenticated_notice_portal` 当前 collector 来说，最关键的登录输入是 `SSO_TGC@.muc.edu.cn`
- `JSESSIONID` 不是需要 operator 长期维护的 canonical 登录态字段；它可以在 collector 打开一次 `https://my.muc.edu.cn/page/11#/` 后由 portal 侧重新派生
- `nginx` 不是主认证凭证；它可以保留，但不应被当作必须手填的核心字段
- repo-local collector 的 `auth:check` / API request context 不能再直接复用旧 `storageState` 打 `/comsys-portal-notice-web/getNoticeByPage`
- canonical 做法是：先载入现有 `storageState`，访问一次 portal 页面完成 session bootstrap，落回刷新后的 `storageState`，再创建 API request context

已确认的最小可行输入：

- 只保留 `SSO_TGC`，删除现有 `JSESSIONID` / `nginx`
- 先访问一次 `https://my.muc.edu.cn/page/11#/`
- 然后再请求 `/comsys-portal-notice-web/getNoticeByPage`

在这个顺序下，portal 会重新签发可用的 host-scoped `JSESSIONID`，notice list API 仍可正常返回 JSON。

同时，历史 donor project 中保留了一份更宽的 portal 栏目配置，可作为 taxonomy reference：

- `1 / 新华网`
- `3 / 民委要闻`
- `4 / 时政头条`
- `5 / 办公通知`
- `6 / 教学通知`
- `8 / 科研通知`
- `9 / 校园新闻`
- `10 / 就业信息`
- `11 / 公示公告`
- `32 / 学工通知`
- `36 / 活动报道`
- `9977 / 推文矩阵`
- `9978 / 会议纪要`
- `9979 / 民大要情`
- `9980 / 学术信息`
- `9982 / 常用下载`

## Live Sample Observations

使用 live 登录态抽样后，已确认 portal 栏目本身不是稳定知识域语义。

### `办公通知`

同一栏目第一页同时出现了：

- 住房公积金提取办理通知
- 全民国家安全教育活动通知
- 健康问题应对指南
- AI 实用技能培训通知

这说明：

- `办公通知` 同时混有办事流程、活动、健康科普、培训通知
- 不能把 `办公通知` 直接等同于规章制度或稳定 institutional knowledge

### `教学通知`

同一栏目第一页同时出现了：

- 访学资助公示
- 教师职业能力测试教室使用通知
- 境外访学项目宣讲
- `CSC学友汇` 活动申报通知

这说明：

- `教学通知` 同时混有公示、操作安排、宣讲、活动型通知
- 它也不能直接等同于 `policy_regulation`

### `科研通知`

抽样第一页基本由以下内容构成：

- 讲座预告
- 讲堂预告
- 论坛 / 名师讲堂

这说明：

- `科研通知` 对当前 `internal_notice` 第一批 priority-now 来说，更像 lecture/publicity 高密度栏目

### `学工通知`

同一栏目第一页同时出现了：

- 优秀毕业生评选通知
- 勤工助学岗位招聘通知
- 创业竞赛遴选通知
- 学籍卡提交通知

这说明：

- `学工通知` 也同时混有评优、公示、招募、流程型事项

## Live Attachment Observations

2026-04-09 对 `policy_regulation` 样本 notice 做 live detail 校验后，已确认：

- portal detail API `getNotice` 的 `notice_info.notice_annext` 才是规章制度 wrapper notice 的真实附件清单来源
- 当前 repo-local collector 之前只消费 `notice_content` 里的 HTML `<a>`，因此会把 `355282 / 351704 / 351699` 这类 notice 误判成 `attachments = []`
- `notice_annex_path` 不是可直接下载的最终 URL；稳定下载契约应构造为：
  - `/comsys-portal-notice-web/download?id=<notice_annex_id>&notice_id=<notice_id>`
- 2026-04-09 已用当前 runtime 登录态小样本确认以下 live attachment facts：
  - `355282` 有 `1` 个 `.docx` 附件
  - `351704` 有 `1` 个 `.pdf` 附件
  - `351699` 有 `1` 个 `.pdf` 附件
- 对应标题与当前 accepted 消费策略固定为：
  - `355282 / 关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知`
    - 附件：`.docx`
    - 目标 lane：`text_extractable`
  - `351704 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
    - 附件：`.pdf`
    - 目标 lane：`ocr_required`
  - `351699 / 关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知`
    - 附件：`.pdf`
    - 目标 lane：`ocr_required`
- 其中 `351704` 与 `351699` 的 live PDF 字节内容相同：
  - `sha256 = f3b90b4975d3a147cdf0258e640c027ec7c4f3634e132bdb2ea138a1323088cc`
- 因此当前固定结论是：
  - 不信任这类 policy / handbook `pdf` 自带 text layer 的消费质量
  - `pdf` 的 canonical 主链路应为 cloud async OCR
  - 重复 PDF 应按内容 hash 去重，避免重复 OCR

对应的 repo-local collector 小样本补抓结果已写入：

- `.tmp/auth-cookie4-runtime/debug-policy-regulation-annex-supplement.json`

## Bounded Policy PDF Expansion Observations

2026-04-09 在 `run14-policy-regulation-expanded-v1` 的 `16` 条 broad sample 上继续补 live detail，并围绕 PDF 形态做了一轮 bounded expansion，结果固定如下：

- `16 / 16` 条 notice live detail 拉取成功
- 其中 `14` 条带附件
- 附件扩展名分布为：
  - `.pdf = 6`
  - `.doc = 11`
  - `.docx = 4`
  - `.xls = 1`
  - `.xlsx = 3`
- 说明 `policy_regulation` 这批 broad sample 虽然 attachment-heavy，但并不是 PDF-heavy；附件主体仍是 Office 文本 / 表单材料

在这 `16` 条 broad sample 的 live 附件 truth 基础上，当前已确认：

- 可见 `pdf_attachment_count = 6`
- 下载成功 `5`
- `186977 / 药学院2021年硕博连读博士研究生招生实施细则`
  - 附件：`附件2：专家推荐信.pdf`
  - portal download URL 返回 `404`
  - 这应被固定记为 portal download-contract failure，而不是“无附件”或“OCR 失败”

随后又对 live 最近页做了 bounded scan：

- `办公通知` / `教学通知` / `学工通知` 最近页扫描后：
  - `policy_regulation_count_in_scan = 8`
  - 新增候选只有 `354011`
- `科研通知` / `公示公告` 边缘扫描后：
  - 新增候选 `351947`、`351896`
  - `351947` 无附件
  - `351896` 带 `1` 个 `.pdf`

因此当前 bounded expansion 的最终结果固定为：

- 新增 `351896 / 经济学院2026年优秀应届本科生推免工作小组、材料审核专家组名单及实施细则`
- 其 PDF：
  - `经济学院关于推荐2026届优秀本科毕业生免试攻读硕士学位研究生工作实施细则.pdf`
  - `sha256 = 65b928a030d8cc04df7c8e77534df741c783a7a77c043fe39ecc7729a5ee7c81`
  - cloud OCR 质量探针结论：`usable`

连同此前已验收的 handbook / rule PDF，小样本当前固定为：

- `downloaded_pdf_count = 6`
- `unique_pdf_sha_count = 4`
- `4 / 4` unique PDF 的 cloud OCR 质量探针结论均为 `usable`

这轮扩大抽样给出的固定解释是：

- `policy_regulation` 当前 bounded recent/live scope 已经接近 PDF 多样性的自然上限
- 再重复同一类 recent scan，大概率不会显著增加新 PDF 形态
- 如需继续扩大 PDF morphology 样本，应优先扩大“历史范围”或“相邻稳定制度类 family 的 morphology sampling”，而不是直接把当前 bounded scan 无限重复
- `186977` 的 404 应保留为 source/download failure evidence，后续单独处理

对应的本地批次报告已写入：

- `.tmp/auth-cookie4-runtime/pdf-policy-samples-20260409/batch-quality-report.md`

随后对当前 donor / live 边界又补了两条 exhaustion evidence：

- `run14` 中剩余未进 expanded batch 的 `policy_regulation` 候选：
  - `354011`：live detail 无附件
  - `204923`：live detail 无附件
  - `187467`：有 `1` 个 `docx`，但仍是征求意见稿，不提供新的 finalized policy PDF 样本
- 对 `办公通知` / `教学通知` / `公示公告` / `学工通知` 的更老页段 `16-30` 做 bounded live scan：
  - `60` 页
  - `1200` 条唯一 notice
  - family classification 结果 `priority_now_notice_count = 0`

因此当前更强的固定结论是：

- `run14` 剩余 policy donor tail 不再新增 PDF
- 当前已验证的 older live page window 也没有扫出新的 `policy_regulation`
- 在不改变 notice-family admission policy 的前提下，这条 `policy_regulation PDF morphology sampling` 线已经基本收口
- 如果还要继续扩大 PDF morphology 样本，应该明确切换到新的 bounded source boundary，而不是继续重复当前 donor tail 和当前 live page windows

## 固定结论

基于以上 live 事实，以下解释固定成立：

- repo-local collector 当前只启用 `5 / 办公通知`，这是 bounded live execution policy，不是 source-channel scope truth
- portal `notice_type` 只能作为 coarse prior，不能直接当作 notice-family truth
- donor bundle 中 `attachments = []` 不能直接等同于 portal live truth；必须区分“portal 无附件”和“collector 漏消费 detail attachment field”
- notice-family 的最终 admission 仍必须依赖 title / body rule config
- live 登录态的主要价值是校正 contract、taxonomy 和 bounded live sampling，不应该阻塞历史 donor absorption
- live auth artifact 的 canonical operator 输入应优先理解为 `SSO_TGC`；`JSESSIONID` 是 runtime-derived portal session，不应再被当作必须人工维护的长期字段

## 对 `rag-data` Historical Intake 的约束

`rag-data` 的 historical donor intake 固定按以下顺序理解：

1. 先用 live 登录态确认 portal taxonomy 与 collector execution policy
2. 再对 donor bundle 做 repo-tracked notice-family analysis
3. 第一批 processing batch 固定从 `policy_regulation` family 开始
4. `event_activity`、`lecture_publicity` 不占用第一批历史处理预算

这里固定禁止：

- 因 repo-local live 默认只开 `办公通知`，就把 donor historical scope 也误缩成只处理 `办公通知`
- 因 portal 栏目名看起来像“教学/办公/科研”，就跳过 family stratification
- 把 donor project 的 notice-type config 直接提升成 repo-level family contract

## Related Docs

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json`
