---
doc_type: reference
status: active
created: 2026-04-30
updated: 2026-04-30
---

# Authenticated Notice Retention State Machine Verification Set

本文记录 notice-first source retention state machine 的首批人工/脚本验证样例。

它不定义新的 consumer admission，也不替代：

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/contracts/campus-notice-runtime-contract.md`

## 验证步骤

每条 notice 按同一顺序验证：

1. 确认 notice identity
   - `site_id`
   - `notice_id`
   - `raw_asset_id`
   - `raw_version_id`
   - source URL / portal print URL
2. 读取标题、正文、portal 分类与 source-truth attachment refs。
3. 先判定 `notice_capture_route`，不得先按附件类型判定。
4. 再对每个 attachment ref 判定 `attachment_capture_policy`。
5. 验证 required source object 计数只包含 handoff bundle、manifest 和明确 required 的 bytes。
6. 验证 downstream consumer admission 是否存在；不存在时不得 materialize 到 target surface。
7. 验证 attachment promotion / retention：
   - metadata-only 不应有 required object 失败
   - quarantine 必须有 expiry
   - promoted 必须有 owner 与 decision id

## 首批样例

### Example 1: 355929

- title：`中央民族大学关于申报2027年度国家艺术基金项目的通知`
- 验证目的：确认申报类 notice 可以只进入 notice discover/card，而不保留附件 bytes。
- 已知 evidence：
  - `phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`
    已包含正文、source URL、classification 与 4 个 attachment refs。
  - `phase-05-multimodal-ocr-consumption-readiness/multimodal-gap-report.json`
    当前把该 notice 的 image / office / archive attachment 标成 pending gap。
  - 这正是旧路径的偏差：它先看到附件类型，再推动 multimodal / attachment processing。

标题与正文确认：

- 标题与正文都指向国家艺术基金项目申报通知。
- 正文已经覆盖申报类别、申报流程、学院初审与校级评审时间节点、注意事项、联系人与电话。
- 附件包括微信群二维码、申报指南 zip、项目基本情况表 xlsx、项目审核汇总表 xlsx。
- 当前产品消费目标是 notice discover/card，不是基金申报附件正文消费。

状态机确认：

- `notice_capture_route=notice_level_query_only`
- `attachment_capture_policy=metadata_only`
- `attachment_capture_state=metadata_recorded`
- `retention_class=metadata_only`
- `required_source_object=false`
- consumer target 只允许是 `notice_level_query`
- 不允许因 `.png`、`.zip`、`.xlsx` 存在而下载或长期保留 bytes

逐步验证要点：

- 正文、标题、URL、发布时间、发布部门足够形成 notice card。
- 附件名、source URL、observed MIME/type 可以进入 `attachment-refs.jsonl`。
- attachment `object_key` 缺失不得导致 source-truth import 失败。
- 如果后续产品决定消费附件内容，必须通过新的 downstream admission 重开，不能复用本轮
  metadata-only 结果隐式晋升。

### Example 2: 355891

- title：`关于做好科级以下岗位聘用工作的通知`
- 验证目的：确认正文足够完整但存在 PDF/office 附件的 notice，不能因为附件类型默认永久保存 bytes。
- 已知 evidence：
  - `phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`
    已包含正文、source URL、classification 与 4 个 attachment refs。
  - `phase-05-multimodal-ocr-consumption-readiness/multimodal-gap-report.json`
    当前记录该 notice 存在 PDF / office attachment pending text extraction。
  - `pre-restore-source-truth-inventory.json` 中存在 source-truth key 与
    attachment document projection 记录，说明历史链路已经把它推向
    attachment/document 方向。

标题与正文确认：

- 标题指向校内科级以下岗位聘用工作。
- 正文已经覆盖聘用原则、岗位和聘期、人员范围、聘用条件、聘用程序、时间安排与职责说明。
- 附件包括正式工作方案 PDF、岗位聘用条件 xlsx、报名表 docx、汇总表 xlsx。
- 当前 classification 为 `staff_internal_admin`，primary route 为 `notice_level_query`，
  processing policy 为 `skip`，没有 admitted downstream target candidates。

状态机确认：

- 当前 `notice_capture_route=notice_level_query_only`
- 4 个附件当前均为 `attachment_capture_policy=metadata_only`
- `attachment_capture_state=metadata_recorded`
- `retention_class=metadata_only`
- `required_source_object=false`
- 不应因为 PDF / DOCX / XLSX 存在而进入 `candidate_document_owner`
- 只有未来显式 admission HR policy / staff document owner target 时，附件 1 PDF 才可重评为
  `fetch_to_quarantine` 或 `fetch_required_for_admitted_owner`

逐步验证要点：

- 先读正文判断 notice 是否已能支撑当前 notice discover/card；本例可以。
- 对每个 attachment ref 单独判定，不按“整条 notice 有 PDF”而全部保留。
- 历史 projection 中已经存在 attachment document 记录，但这不是当前状态机的 promotion
  证据；缺少 `promotion_owner` 与 `promotion_decision_id` 时不得视为 admitted source bytes。
- 如果未来重开 owner target，必须从 downstream admission manifest 驱动 promotion。

### Example 3: 355881

- title：`关于开通丰台校区社会实践专车的通知`
- 验证目的：确认 service-status / schedule 类 notice 按 required fact group 决定是否需要图片 bytes。
- 已知 evidence：
  - `phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`
    已包含正文、source URL、classification 与 1 个 inline image attachment ref。
  - `phase-06-3-schedule-image-ocr-mini-batch/schedule-image-ocr-evidence-inventory.json`
    记录该 notice 的 PNG image object exists，OCR 候选用途为 `schedule_table_image`。
  - 同一 evidence 的 post-run preview 表明正文已经包含运行区间、时间、乘车地点与预约方式。

标题与正文确认：

- 标题指向丰台校区社会实践专车。
- 正文已经覆盖适用日期、出发/接站路线、班次时间、乘车地点、预约开始时间、预约入口与扫码签到方式。
- 图片 OCR 仅补充接站地点更细的地标描述；它不是当前 transport schedule 的必需事实来源。

状态机确认：

- `notice_capture_route=candidate_service_fact`
- target candidate 为 `transport_schedule`，可派生特殊预约/服务指南候选，但不能由 source
  retention 阶段直接打开 runtime。
- 当前正文已经覆盖 transport schedule required fact groups。
- inline image 当前 `attachment_capture_policy=metadata_only`
- `attachment_capture_state=metadata_recorded`
- `retention_class=metadata_only`
- `required_source_object=false`
- 如果后续 materializer 把“工地前马路边”等图片补充地点视为 target-required fact，再单独将该图片
  重评为 `fetch_to_quarantine`

逐步验证要点：

- 验证正文是否已覆盖出发/接站区间、班次时间、地点、适用日期、预约方式。
- 验证图片 OCR 只补充哪个 fact group，例如 pickup location 细节。
- 如果图片只补充非必要描述，不应阻断 service-status materialization。
- 如果图片补充必要地点/时刻表，则该单个图片 attachment 进入 quarantine / OCR path，
  不是整条 notice 的所有附件默认进入 OCR。

## Batch 2: 30 条分层抽样逐条验证

样本来源：

- `phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`

抽样分层：

- classifier service-status 候选：13 条全量覆盖；人工验证后 2 条降级为仅搜索。
- regulation / file-release owner：7 条。
- `notice_level_query + process` 高风险旧策略桶：7 条。
- `notice_level_query + metadata_only + attachments` 负样本：3 条。

判定规则：

- 先读 title / body 是否已覆盖当前产品目标所需事实。
- 再判定 `notice_capture_route`。
- 最后只对缺失事实所在附件给 `fetch_to_quarantine` 或 required bytes。
- 当前没有 admitted downstream owner 的附件，一律不得仅因类型或数量晋升。

### Service-status 候选

- `355881`：关于开通丰台校区社会实践专车的通知。
  - 标题信号：专车 / 丰台校区，属于交通服务运行变化。
  - 正文证据：正文列出 4 月 28 日至 4 月 30 日、出发 / 接站路线、
    07:30 / 09:00 / 10:30 / 12:00 与 18:00 / 19:30 / 21:00
    班次、上下车地点、预约入口与扫码签到方式。
  - `notice_capture_route=candidate_service_fact`。
  - 图片只补充更细地点描述，当前 `metadata_only`。
  - 若 transport materializer 将图片地点视为必需，再重评为 quarantine。
- `355867`：关于 4 月 27 日-5 月 5 日期间两校区班车及地铁接驳车安排的通知。
  - 标题信号：两校区班车 / 地铁接驳车安排，属于交通服务运行安排。
  - 正文证据：正文只写“4 月 27 日两校区班车安排”和
    “4 月 28 日-5 月 5 日两校区班车及地铁接驳车安排”，没有给出具体班次。
  - `notice_capture_route=candidate_service_fact`。
  - 3 张图片均为 `fetch_to_quarantine`，用于 OCR 班次表。
  - materializer admission 前不算 admitted source bytes。
- `355650`：关于静园 10 号楼负一层女浴室试运行的通知。
  - 标题信号：浴室试运行，属于校园设施开放状态变化。
  - 正文证据：正文列出静园 10 号楼负一层、两个浴室区域、28 个和 90 个
    淋浴位、早 7:00-晚 22:30 与中午 12:00-晚 22:30 开放时间。
  - `notice_capture_route=candidate_service_fact`。
  - 图片是设施现场/布局辅助，当前 `metadata_only`。
- `355549`：关于暂时停用相关区域停车权限的通知。
  - 标题信号：暂时停用停车权限，属于校园交通/设施可用性变化。
  - 正文证据：正文说明因海淀校区 15 号楼南侧场地维修，停用小篮球场
    东、西两侧停车位，并给出学生 6、7 号公寓之间的替代停车区域。
  - 附件红色区域承载更精确空间边界。
  - `notice_capture_route=candidate_service_fact`。
  - 若只做通知卡片则 `metadata_only`。
  - 若 service-status 需要精确区域边界，则该图片 `fetch_to_quarantine`。
- `355122`：关于两校区学生通勤班车增加班次的通知。
  - 标题信号：通勤班车增加班次，属于交通服务运行变化。
  - 正文证据：正文只说明 3 月 20 日起增加 2 个班次，并明确写
    “具体见下表”；具体新增班次不在正文中。
  - `notice_capture_route=candidate_service_fact`。
  - 班次表图片为 required fact carrier，`fetch_to_quarantine`。
- `355479`：关于 2026 届教师职业能力测试期间使用教室的通知。
  - 标题信号：考试期间使用教室，属于教室临时封闭/可用性变化。
  - 正文证据：正文覆盖 4 月 10 日 9:00-11:30 考试、文华楼西区 0107、
    0201、0204 教室、4 月 9 日 18:30 至 4 月 10 日 14:00 封闭。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355804`：关于 2026 年度辅导员、教辅人员公开招聘考试使用教室的通知。
  - 标题信号：招聘考试使用教室，属于教学楼区域临时可用性变化。
  - 正文证据：正文覆盖 4 月 26 日 14:30-17:00 考试、文华楼东区
    1-5 层教室、4 月 26 日 10:00-17:00 封闭和联系电话。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355189`：关于海淀区教委所属事业单位公开招聘考试使用教室的通知。
  - 标题信号：招聘考试使用教室，属于教室临时占用/封闭事实。
  - 正文证据：正文覆盖 3 月 28 日 8:00-12:00 笔试、文华楼文东和文西
    1-5 层、3 月 27 日 19:00 至 3 月 28 日 12:00 封闭。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355859`：关于地方人才招录考试占用教室的通知。
  - 标题信号：招录考试占用教室，属于教室临时占用事实。
  - 正文证据：正文覆盖 4 月 30 日 8:00-18:00、海淀校区文华楼东二层
    和三层所有教室、无关人员避让要求。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355283`：校医院清明节假期工作安排。
  - 标题信号：校医院假期工作安排，属于医疗服务开放时间变化。
  - 正文证据：正文覆盖 4 月 4 日至 4 月 6 日假期、两校区只开放急诊、
    海淀 8:00-11:30 / 14:00-17:00、丰台 8:30-11:30 /
    14:00-17:00 和其他时间拨打 120。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355512`：关于本周六临时增加学生班车班次的通知。
  - 标题信号：临时增加学生班车班次，属于交通服务运行变化。
  - 正文证据：正文覆盖本周六、丰台校区发往海淀校区、新增 6:40
    学生班次。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。

### Regulation / file-release owner 候选

以下 7 条均不是普通 notice card。正文只是 file-release metadata，PDF 才是正式 owner
source。因此它们固定走 document owner path。

- `646`：中央民族大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法。
  - 标题信号：管理办法，属于稳定制度正文。
  - 正文证据：正文只有文件编号、发布时间、发布/说明部门、文件类型、
    下载地址和原始文件名；正式内容在 PDF。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。
  - 进入 regulation materializer 前仍需 downstream admission。
- `647`：中央民族大学 2026 届推荐应届本科毕业生免试攻读硕士学位研究生实施办法。
  - 标题信号：实施办法，属于稳定制度正文。
  - 正文证据：正文是 file-release metadata，只有文号、发布时间、部门、
    文件类型、下载地址和原始 PDF 文件名。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。
  - 后续 promotion owner 应为 `regulations/*` admission。
- `560`：中央民族大学强基计划学生本研衔接转段工作办法。
  - 标题信号：工作办法，属于稳定制度正文。
  - 正文证据：正文没有办法条文，只提供文号、发布时间、说明部门、文件类型
    和 PDF 下载地址。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。
- `537`：中央民族大学本科生生活物价补贴管理办法。
  - 标题信号：管理办法，属于稳定制度正文。
  - 正文证据：正文只有 file-release metadata；补贴办法正文在 PDF。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。
- `592`：中央民族大学学生参加国际外语水平考试暨国际化培养项目奖励暂行办法。
  - 标题信号：奖励暂行办法，属于稳定制度正文。
  - 正文证据：正文只有文号、发布时间、说明部门、文件类型和下载地址。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。
- `481`：中央民族大学接收校内外优秀应届本科毕业生免试攻读博士研究生工作办法。
  - 标题信号：工作办法（试行），属于稳定制度正文。
  - 正文证据：正文只列文号、发布时间、部门、文件类型和 PDF 原始文件。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。
- `572`：中央民族大学排课管理办法。
  - 标题信号：管理办法，属于稳定制度正文。
  - 正文证据：正文只有 file-release metadata；排课管理办法正文在 PDF。
  - `notice_capture_route=candidate_document_owner`。
  - PDF `fetch_required_for_source_truth`。

### Notice-level query 旧 `process` 高风险桶

- `355929`：中央民族大学关于申报 2027 年度国家艺术基金项目的通知。
  - 标题信号：基金项目申报，属于科研项目申报通知。
  - 正文证据：正文覆盖申报类别、在线填报、学院初审、校级评审、6 月 3 日
    等时间节点、申报限制、联系人和电话。
  - `notice_capture_route=notice_level_query_only`。
  - 群二维码、申报指南 zip、统计表 xlsx、汇总表 xlsx 均为 `metadata_only`。
- `355766`：关于开展 2026-2027 年度本科生体质健康测试的通知。
  - 标题信号：本科生体质健康测试，属于学生事务/教学运行通知。
  - 正文证据：正文覆盖 2023 / 2024 级本科生、测试项目、5 月 16 日至
    6 月上旬测试窗口、两校区测试中心、室外项目安排和注意事项。
  - 具体校区时间安排与表单在附件中，但当前没有 admitted health/test target。
  - `notice_capture_route=notice_level_query_only`。
  - 11 个附件均为 `metadata_only`。
  - 未来若打开体测日程 target，再重评附件 2/3。
- `355384`：关于公布研究生课程建设和教改项目入选学生名单的通知。
  - 标题信号：入选学生名单公布，属于名单/结果发布。
  - 正文证据：正文说明项目招募已完成，并列出 10 个项目名称和对应附件名单。
  - 当前只服务 notice discover；名单附件不进入默认消费。
  - `notice_capture_route=notice_level_query_only`。
  - 10 个名单 xlsx 均为 `metadata_only`。
- `355798`：关于党建项目结项及立项工作的通知。
  - 标题信号：项目结项及立项，属于内部申报/研究课题工作通知。
  - 正文证据：正文说明 2025 年度结项和 2026 年度立项工作，并列出结项表、
    评审表、延期申请表、课题指南、申报书和汇总表附件。
  - 当前没有 admitted 党建项目材料 owner target。
  - `notice_capture_route=notice_level_query_only`。
  - PDF、DOC、DOCX 附件均为 `metadata_only`。
- `355006`：关于中央高校改善基本办学条件设备购置类申报工作的通知。
  - 标题信号：设备购置类项目申报，属于内部业务申报流程。
  - 正文证据：正文覆盖申报部门及范围、设备购置边界、统筹规划、绩效目标、
    项目材料要求和申报流程。
  - 表单、申报指南、绩效指标库是后续办事/表单 target 才需要的 owner。
  - 当前 `notice_capture_route=notice_level_query_only`。
  - 8 个附件均为 `metadata_only`。
- `355473`：关于“挑战杯”专项赛校内遴选的通知。
  - 标题信号：赛事校内遴选，属于学生项目/赛事申报通知。
  - 正文证据：正文覆盖专项赛赛道设置、校内遴选、团队材料和参赛要求。
  - 榜单 PDF 和模板附件没有 admitted event/application owner target。
  - `notice_capture_route=notice_level_query_only`。
  - 7 个附件均为 `metadata_only`。
- `355687`：关于本科毕业生体测补测的通知。
  - 标题信号：本科毕业生体测补测，属于学生状态/教学运行通知。
  - 正文证据：正文覆盖 2022 级本科生、免缓测/出国留学未测学生、成绩计算规则、
    补测对象、测试项目和主要安排。
  - 附件含学生名单和申请表，不应默认进入附件消费。
  - `notice_capture_route=notice_level_query_only`。
  - 7 个附件均为 `metadata_only`。

### Notice-level metadata-only 负样本

- `355085`：关于丰台校区开展废旧非机动车集中清理及规范停放管理的通知。
  - 标题信号：非机动车清理与停放管理，但重点是保卫处行政治理与合规告知，
    不是某个可查询服务的开放、关闭、班次或容量变化。
  - 正文证据：正文覆盖废旧车辆认定标准、3 月 31 日集中清理、B2 地下车库
    存放、自查期限、认领和后续规范停放管理要求。
  - `notice_capture_route=notice_level_query_only`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355570`：关于丰台校区废旧非机动车清理后认领事宜的通知。
  - 标题信号：清理后认领，属于保卫处行政处置后的通知告知，不是服务状态
    或 service-status materializer 的稳定事实。
  - 正文证据：正文覆盖即日起至 6 月 30 日的认领期限、综合楼东区 116
    办理地点、身份证明/车辆证明材料和 7 月 1 日后统一处置规则。
  - `notice_capture_route=notice_level_query_only`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355891`：关于做好科级以下岗位聘用工作的通知。
  - 标题信号：岗位聘用，属于内部人事行政通知。
  - 正文证据：正文覆盖聘用原则、岗位和聘期、人员范围、聘用条件、
    个人报名、用人单位选聘、调剂聘用、学校审批、公示聘用和职责说明。
  - 当前没有 admitted HR/document-owner target。
  - `notice_capture_route=notice_level_query_only`。
  - PDF、XLSX、DOCX 附件均为 `metadata_only`。
- `355532`：关于 2026 年“挑战杯”主体赛赛道变更的通知。
  - 标题信号：赛事赛道变更，属于学生竞赛通知。
  - 正文证据：正文覆盖先进制造、新一代信息技术、生物医药、新能源新材料、
    现代农业、新消费与文化创意、现代服务与社会治理等赛道调整。
  - 附件为立项名单、组队表、申报表、负面清单、PPT 说明和承诺书。
  - `notice_capture_route=notice_level_query_only`。
  - 6 个附件均为 `metadata_only`。
- `355866`：关于推荐北京高校优秀共产党员、优秀党务工作者、先进基层党组织的通知。
  - 标题信号：党内评优推荐，属于治理/党务内部通知。
  - 正文证据：正文覆盖推荐名额、优秀共产党员/党务工作者/先进基层党组织
    范围、推荐条件、程序和材料要求。
  - 附件为审批表、汇总表和填写说明；当前无 admitted governance owner target。
  - `notice_capture_route=notice_level_query_only`。
  - 5 个附件均为 `metadata_only`。

### Batch 2 结论

- classifier service-status 桶中的 `355085` 与 `355570` 人工验证后降级为
  `notice_level_query_only`，不进入 service-status downstream。
- 30 条中只有 3 条需要附件 quarantine：
  - `355867` 的 3 张班车/接驳车安排图片。
  - `355122` 的 1 张班次表图片。
  - `355549` 的停车红色区域图片仅在需要精确空间边界时 quarantine。
- 7 条 file-release / regulation owner 的 PDF 是 source-truth required bytes。
- 其余 notice-level 查询样本即使附件很多，也应保持 metadata-only。
- 旧 `attachment_processing_policy=process` 在 notice-level query 桶中误伤明显，
  需要被新状态机替换为 notice-first 判定。

## Batch 3: 旧 `process` / 无 target 样本全量复核

样本来源：

- `phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`
- 条件：`source_surface=notice`、`attachment_processing_policy=process`、
  `target_candidates=[]`
- 样本数：83 条

本批次目标是复核旧策略中“有附件就 process，但没有 downstream target”的高风险池。
判定仍按标题和正文先确定 `notice_capture_route`，再决定附件 policy。

### Attachment-owner-like 表单 / 手册类

这些条目的正文为空或只提示下载附件，attachment 是表单、模板、手册或证明材料本体。
它们不是普通正文完整 notice，但当前也没有 admitted `form_template`、`service_guide`
或 `manual` owner target。因此本轮只能记录为候选 owner-like source relation：

- `notice_capture_route=candidate_document_owner`
- 当前 `attachment_capture_policy=metadata_only`
- `required_source_object=false`
- 未来只有显式 admission 表单中心、办事指南或手册 owner target 时，才重评为
  `fetch_required_for_admitted_owner`

逐条结论：

- `中央民族大学学生证补办申请表`：表单本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学2020年度预算申报表样`：预算申报表样本体在 XLS；当前无表单 owner target，metadata-only。
- `中央民族大学学生毕业证书和学位证书复印件加盖印章审核表`：审核表本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学学生毕业证书和学位证书翻译件加盖印章审核表`：审核表本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学 2021年度预算申报表`：预算申报表本体在 XLS；当前无表单 owner target，metadata-only。
- `中央民族大学工程结算付款审批单`：审批单本体在 DOC；当前无表单 owner target，metadata-only。
- `中央民族大学工程预付（进度）款付款审批单`：审批单本体在 DOC；当前无表单 owner target，metadata-only。
- `中央民族大学货物(服务)采购付款审批单`：审批单本体在 DOC；当前无表单 owner target，metadata-only。
- `中央民族大学法定代表人手签章使用审批表`：审批表本体在 DOC；当前无表单 owner target，metadata-only。
- `中央民族大学财务事项问答手册`：正文只提示下载附件，手册 PDF 是 owner-like；当前无手册 owner target，metadata-only。
- `中央民族大学教职工慰问金（品）申请表`：申请表本体在 DOC；当前无表单 owner target，metadata-only。
- `外请人员参加活动备案表`：备案表本体在 DOCX；当前无表单 owner target，metadata-only。
- `师生参加校外活动备案表`：备案表本体在 DOCX；当前无表单 owner target，metadata-only。
- `移动平台关注方式`：操作说明 PDF 是 owner-like；当前无 IT service guide target，metadata-only。
- `北京高校非北京户籍大学生在学证明`：证明模板本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学非北京户籍在校本科生申请办理出入境证件审查登记表`：登记表本体在 DOCX；当前无表单 owner target，metadata-only。
- `“民大通”APP使用手册`：使用手册 PDF 是 owner-like；当前无 IT service guide target，metadata-only。
- `中央民族大学国内差旅费（自驾车租车）事项审批表`：审批表本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学出差人员出差住宿证明`：证明模板本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学出差人员国内差旅住宿费限额标准明细表`：明细表本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学国内差旅费情况说明表`：说明表本体在 DOCX；当前无表单 owner target，metadata-only。
- `中央民族大学出差审批单`：审批单本体在 DOCX；当前无表单 owner target，metadata-only。

### Conditional service fact 样本

- `关于进一步加强校园交通安全管理的通知`：正文覆盖校园停车秩序、通行权限、
  停车区域调整与违规处理规则；它可以作为 `candidate_service_fact`，但不能因为同时带有
  PNG 区域图和管理规定 DOCX 就整条默认 process。当前停车可用性如果只做通知卡片，
  PNG 为 `metadata_only`；只有 service-status / navigation target 明确需要精确红蓝线空间边界时，
  该 PNG 才可重评为 `fetch_to_quarantine`。附带的《校园道路交通安全管理暂行规定》
  DOCX 是 owner-like regulation attachment，但当前没有本条 admission，保持 metadata-only。

### 正文完整的 notice-level query 样本

以下条目正文已经覆盖当前 notice discover/card 需要的核心事实，附件主要是表单、名单、指南、
二维码、模板、汇总表或支撑材料。当前没有 admitted downstream target，因此：

- `notice_capture_route=notice_level_query_only`
- 附件均为 `attachment_capture_policy=metadata_only`
- `required_source_object=false`
- 不得因为 PDF / DOC / XLS / 图片 / 压缩包存在而进入默认 byte retention

逐条结论：

- `关于开展2026年春季学期研究生助教岗位聘任工作的通知`：正文覆盖岗位职责、设聘、申请和时间安排；制度 PDF / 操作手册不进入当前 owner target。
- `关于开展2026年博士硕士学位授权学科和专业学位授权类别动态调整工作的通知`：正文覆盖动态调整范围、流程和报送要求；申请表与条件文件 metadata-only。
- `关于办理2025年度个人所得税综合所得年度汇算的通知`：正文覆盖办理时间、预约、操作提醒和责任边界；图片只作操作辅助。
- `关于开展2027-2029年工程类财政专项申报工作的通知`：正文覆盖申报范围、材料要求和提交方式；申报书和排序表 metadata-only。
- `关于开展2027-2029年中央高校改善基本办学条件（设备购置类）申报工作的通知`：
  正文覆盖申报范围、流程和材料要求；8 个附件当前无 admitted owner target。
- `关于申报5月批量集中采购的通知`：正文覆盖品目、时间节点和系统提交要求；图片只作操作辅助。
- `关于开展2025-2026学年春季学期家庭经济困难学生补充认定和复核工作的通知`：正文覆盖申请阶段、复核流程和时间；操作指南、表单、汇总表 metadata-only。
- `关于开展2026年西部计划志愿者招募选拔工作的通知`：正文覆盖对象、报名流程、时间和联系方式；汇总表和推荐报告 metadata-only。
- `关于校园监控录像查询申请流程的通知`：正文覆盖线上/线下申请、审批流程、地点和保密要求；线下申请表 metadata-only。
- `关于2026年无偿献血活动安排的通知`：正文覆盖报名、献血时间地点、流程和注意事项；条件说明、二维码和群材料 metadata-only。
- `关于申报辅导员工作室的通知`：正文覆盖建设目标、申报条件和流程；方向清单和申请表 metadata-only。
- `关于2026年离退休教职工体检安排的通知`：正文覆盖报名、体检时间、项目、地点和查询方式；体检须知 metadata-only。
- `关于组织开展2026年北京市“高创计划·青年人才托举工程”候选人推荐工作的通知`：正文覆盖推荐渠道、名额、条件和报送要求；汇总表 metadata-only。
- `关于征集《北京社会科学年鉴2026》相关稿件的通知`：正文覆盖征稿内容、格式和提交要求；稿件模板 metadata-only。
- `关于公布2025年研究生课程建设和教育教学改革项目（“项目制”教学改革项目）入选学生名单的通知`：
  正文说明入选名单发布和项目范围；名单 XLSX 不进入当前 downstream。
- `关于公布我校2026年国家留学基金委与加拿大麦克马斯特大学合作奖学金项目候选人名单的通知`：正文覆盖公示期和异议方式；候选名单 metadata-only。
- `关于提交2022级本科生及2024级第二学士学位学生学籍卡的通知`：正文覆盖填写、提交和缺卡领取要求；填写须知和名单表 metadata-only。
- `关于提交2022级本科生及2024级第二学士学位学生学籍卡的通知`：重复 source notice，正文覆盖相同提交要求；附件 metadata-only。
- `关于确认发放2026年3月份研究生助管、助研岗位津贴的通知`：正文覆盖发放主体、核定和报送要求；报送表 metadata-only。
- `关于举办 “2026 第九届全国应用统计专业学位研究生案例大赛” 中央民族大学校内选拔赛的通知`：
  正文覆盖赛事目标、报名、材料和校内安排；报名/模板附件 metadata-only。
- `关于开展2026年度“发明创业奖”评选工作的通知`：正文覆盖奖项、申报要求、材料和时间；申报附件 metadata-only。
- `关于公布我校2026年国家留学基金委与英国利物浦大学合作奖学金项目候选人名单的通知`：正文覆盖公示期和异议方式；候选名单 metadata-only。
- `关于申报组织开展2026年“CSC学友汇”活动的通知`：正文覆盖活动目标、申报条件和材料要求；申报模板 metadata-only。
- `关于举办2026年“挑战杯”首都大学生创业计划竞赛“揭榜挂帅”机制专项赛校内遴选的通知`：正文覆盖赛道、参赛要求和材料提交；榜单、模板和承诺书 metadata-only。
- `【境外访学项目宣讲】美国加利福尼亚大学伯克利分校 University of California,
  Berkeley`：正文覆盖宣讲时间、地点、内容和报名信息；项目附件 metadata-only。
- `关于2025年春季及2025年秋季学期本科生境外访学资助情况的公示`：正文覆盖资助情况公示和异议方式；名单 metadata-only。
- `关于组织开展2026年“4·15”全民国家安全教育系列活动的通知`：正文覆盖活动主题、启动仪式、讲座、线上活动和要求；线上活动说明 metadata-only。
- `关于评选2026届北京市优秀毕业生和校级优秀毕业生的通知`：正文覆盖评选对象、条件、程序和时间；名额表、推荐表等 metadata-only。
- `关于办理丰台校区保障房住房公积金提取的通知`：正文覆盖适用人群、材料、办理地点和流程；表格 metadata-only。
- `关于公布我校2026年国家建设高水平大学公派研究生项目候选人名单的通知（更新）`：正文覆盖公示期和异议方式；候选名单 metadata-only。
- `关于2027年度国家艺术基金项目申报的预通知`：正文覆盖系统开通时间、申报准备和联系信息；附件 metadata-only。
- `关于公布我校2026年秋季派出研究生赴台访学项目（台湾艺术大学）候选人名单的通知`：正文覆盖公示期和异议方式；候选名单 metadata-only。
- `关于召开保密委员会2026年第一次全体会议暨保密工作会议的通知`：正文覆盖会议时间、地点、主持人和参会人员；附件 metadata-only。
- `关于2026届本科毕业生学历学位图像采集的通知`：正文覆盖采集对象、时间、流程和要求；操作说明 metadata-only。
- `关于2026届本科毕业生学历学位图像采集的通知`：重复 source notice，正文覆盖相同采集要求；附件 metadata-only。
- `关于举办第十六届全国大学生电子商务“创新、创意及创业”挑战赛常规赛拟推荐参加北京市赛答辩排名赛的通知`：正文覆盖推荐背景、排名赛和名单发布；名单附件 metadata-only。
- `关于开展2026年“春蕾茁壮公益计划” 助学金评选工作的通知`：正文覆盖评选条件、名额、流程和材料；表单附件 metadata-only。
- `关于开展2026年师生思想政治状况滚动调查工作的通知`：正文覆盖调查对象、抽样、访谈、问卷和报送要求；抽样表与模板 metadata-only。
- `关于公布我校2026年秋季派出研究生赴台访学项目（中国文化大学、台湾辅仁大学）候选人名单的通知`：正文覆盖公示期和异议方式；候选名单 metadata-only。
- `关于开展2026年秋季派出本科生赴香港浸会大学访学项目补充选拔工作的通知`：正文覆盖补充选拔背景、条件和流程；申请附件 metadata-only。
- `关于举办第十六届全国大学生电子商务“创新、创意及创业”挑战赛实战赛校级终审答辩排名赛的通知`：正文覆盖比赛背景、终审答辩和名单安排；名单附件 metadata-only。
- `信息工程学院关于评选2026届北京市优秀毕业生和校级优秀毕业生的通知`：正文覆盖学院评选小组、资格和材料要求；附件 metadata-only。
- `关于本学期劳动教育理论在线学习提醒的通知`：正文覆盖结课时间、学习要求和通过条件；未通过名单 metadata-only。
- `关于开展2022级本科毕业生和开展2025-2026年度体测补测的通知`：正文覆盖补测对象、成绩核对和测试安排；名单、申请表和图片 metadata-only。
- `关于进一步规范学位答辩委员会组成及答辩公告管理的通知`：正文覆盖答辩委员会组成、公告管理和要求；公告模板 metadata-only。
- `关于做好2025-2026学年第二学期期末考试工作的通知`：正文覆盖期末考试时间、工作安排和命题要求；考试表、清单和格式要求 metadata-only。
- `信息工程学院关于2026年“春蕾茁壮公益计划助学金”评选结果的公示`：正文覆盖评选结果公示、异议方式和地点；名单 metadata-only。
- `关于开展2025-2026学年第二学期学生电子信息数据完善与更新工作的通知`：正文覆盖数据更新对象、时间和操作路径；操作指南和图片 metadata-only。
- `关于公示2026年秋季派出本科生赴香港浸会大学访学项目补充入选名单的通知`：正文覆盖公示期和异议方式；入选名单 metadata-only。
- `关于申报6月批量集中采购的通知`：正文覆盖品目、时间节点和系统提交要求；图片只作操作辅助。
- `关于开展2026-2027年度本科生体质健康测试的通知`：正文覆盖测试对象、项目、
  窗口和注意事项；时间安排、表单和图片当前无 admitted health/test target。
- `关于开展2025年度党建引领创新攻坚示范项目、优秀党支部工作法、党建和思想政治工作研究课题结项及2026年度立项工作的通知`：
  正文覆盖结项、立项和材料要求；附件当前无 admitted owner target。
- `关于开展2026届本科生毕业资格、学士学位资格审核工作的通知`：正文覆盖资格审核、
  学位授予准备和申请安排；附带规则 PDF 是 owner-like，但本条当前无 regulation admission。
- `关于2026年“北京社科青年学者文库”申报工作的通知`：正文覆盖申报对象、条件、材料和时间；申请书和汇总表 metadata-only。
- `关于认领和清理历年到校未入账科研经费的通知`：正文覆盖清理对象、认领时限和联系人；清单 metadata-only。
- `2026“外研社·国才杯”“理解当代中国”全国大学生外语能力大赛定题演讲报名通知`：正文覆盖参赛对象、内容、形式和报名方式；图片只作宣传/报名辅助。
- `中央民族大学关于申报2027年度国家艺术基金项目的通知`：正文覆盖申报类别、流程、时间节点和联系人；二维码、指南、表格 metadata-only。
- `江苏省2026年应届优秀大学毕业生选调乡镇（街道）职位拟录用人选公示`：正文覆盖公示期、联系方式和异议渠道；名单 metadata-only。
- `关于组织开展2026年“千人百村”系列活动青年创业项目遴选及“汇谷杯”创新创业大赛的通知`：
  正文覆盖活动时间、对象、内容和申报方式；报名统计表 metadata-only。
- `关于开展2026-2027学年第一学期本（预）科课程安排的通知`：正文覆盖排课准备、课程安排、调整和工作要求；执行计划表与课程变动表 metadata-only。

### Batch 3 结论

- 83 条旧 `process` / 无 target 样本中，只有 `关于进一步加强校园交通安全管理的通知`
  是当前应保留为 `candidate_service_fact` 的条件样本。
- 22 条表单 / 手册类是 owner-like attachment relation，但当前没有 admitted owner target；
  它们不能变成 required source bytes。
- 60 条正文完整 notice 应降为 `notice_level_query_only`，附件均 metadata-only。
- 这批样本进一步证明：`attachment_processing_policy=process` 不能作为 retention 决策输入；
  必须先由 `notice_capture_route` 判定，再按 target-required fact gap 或 admitted
  owner 决定 bytes。

## 当前实现状态与剩余缺口

Phase 8 已落地第一版 source retention 决策模型：

- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_retention_decision.py`
  固定 notice-first route 到 attachment policy 的纯决策函数。
- notice source-truth 生成会写入 `notice_capture_route`、
  `attachment_capture_policy_counts`、`attachment_capture_state_counts`、
  `retention_class_counts`、`required_source_object_count`、
  `metadata_only_attachment_ref_count`、`quarantine_attachment_ref_count` 与
  `admitted_source_byte_ref_count`。
- `attachment-refs.jsonl` 会写入 per-ref `attachment_capture_policy`、
  `attachment_capture_state`、`byte_fetch_required`、`required_source_object`、
  `retention_class` 与 promotion / terminal outcome 占位字段。
- collected notice reimport preview 会暴露 `source_retention` summary，并且不再把
  metadata-only attachment bytes 计入 planned `source_object_refs`。

仍未完成的部分：

当前 repo 已具备部分粗粒度状态：

- collector run：`started` / `success` / `failed`
- run verification：`verified` / `missing_required_objects`
- attachment storage：`reference_only` / `object_store` / `local`
- attachment provenance：`reference_only` / `collected_internal`
- routing sample：`metadata_only` / `process`

但它还没有完整表达或执行：

- quarantine byte fetch lifecycle / expiry / cleanup。
- `fetch_required_for_admitted_owner` 的 promotion owner 与 promotion decision id
  写入。
- collector live 层按 retention policy 跳过不必要附件下载；当前 Phase 8 先收口
  ingestion/source-truth/preview。
- run ledger required source object verification 与 retention summary 的完全对齐。

因此后续 collector/live cleanup 必须继续按 retention decision replay / dry-run report
验收，不能把旧 pending multimodal gap 或历史附件下载状态直接当作正确目标态。
