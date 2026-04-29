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

- service-status 候选：13 条全量覆盖。
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
- `355085`：关于丰台校区开展废旧非机动车集中清理及规范停放管理的通知。
  - 标题信号：非机动车清理与停放管理，属于校园交通治理服务事实。
  - 正文证据：正文覆盖废旧车辆认定标准、3 月 31 日集中清理、B2 地下车库
    存放、自查期限、认领和后续规范停放管理要求。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
- `355570`：关于丰台校区废旧非机动车清理后认领事宜的通知。
  - 标题信号：清理后认领，属于校园交通/资产认领服务事实。
  - 正文证据：正文覆盖即日起至 6 月 30 日的认领期限、综合楼东区 116
    办理地点、身份证明/车辆证明材料和 7 月 1 日后统一处置规则。
  - `notice_capture_route=candidate_service_fact`。
  - 无附件 refs；本条不产生 attachment policy row。
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
  - 正文已覆盖申报类别、流程、时间节点、注意事项和联系方式。
  - `notice_capture_route=notice_level_query_only`。
  - 群二维码、申报指南 zip、统计表 xlsx、汇总表 xlsx 均为 `metadata_only`。
- `355766`：关于开展 2026-2027 年度本科生体质健康测试的通知。
  - 正文已覆盖测试对象、项目、主要时间地点和注意事项。
  - 具体校区时间安排与表单在附件中，但当前没有 admitted health/test target。
  - `notice_capture_route=notice_level_query_only`。
  - 11 个附件均为 `metadata_only`。
  - 未来若打开体测日程 target，再重评附件 2/3。
- `355384`：关于公布研究生课程建设和教改项目入选学生名单的通知。
  - 正文说明 10 个项目及附件名单。
  - 当前只服务 notice discover；名单附件不进入默认消费。
  - `notice_capture_route=notice_level_query_only`。
  - 10 个名单 xlsx 均为 `metadata_only`。
- `355798`：关于党建项目结项及立项工作的通知。
  - 正文说明工作事项并列出 8 个表单/指南附件。
  - 当前没有 admitted 党建项目材料 owner target。
  - `notice_capture_route=notice_level_query_only`。
  - PDF、DOC、DOCX 附件均为 `metadata_only`。
- `355006`：关于中央高校改善基本办学条件设备购置类申报工作的通知。
  - 正文已覆盖申报范围、要求和流程。
  - 表单、申报指南、绩效指标库是后续办事/表单 target 才需要的 owner。
  - 当前 `notice_capture_route=notice_level_query_only`。
  - 8 个附件均为 `metadata_only`。
- `355473`：关于“挑战杯”专项赛校内遴选的通知。
  - 正文已覆盖赛道设置、校内遴选流程与基本要求。
  - 榜单 PDF 和模板附件没有 admitted event/application owner target。
  - `notice_capture_route=notice_level_query_only`。
  - 7 个附件均为 `metadata_only`。
- `355687`：关于本科毕业生体测补测的通知。
  - 正文已覆盖补测对象、成绩规则、测试对象和主要安排。
  - 附件含学生名单和申请表，不应默认进入附件消费。
  - `notice_capture_route=notice_level_query_only`。
  - 7 个附件均为 `metadata_only`。

### Notice-level metadata-only 负样本

- `355891`：关于做好科级以下岗位聘用工作的通知。
  - 正文已覆盖岗位聘用原则、范围、条件、程序和时间安排。
  - 当前没有 admitted HR/document-owner target。
  - `notice_capture_route=notice_level_query_only`。
  - PDF、XLSX、DOCX 附件均为 `metadata_only`。
- `355532`：关于 2026 年“挑战杯”主体赛赛道变更的通知。
  - 正文已覆盖赛道调整、报名和材料要求。
  - 附件为立项名单、组队表、申报表、负面清单、PPT 说明和承诺书。
  - `notice_capture_route=notice_level_query_only`。
  - 6 个附件均为 `metadata_only`。
- `355866`：关于推荐北京高校优秀共产党员、优秀党务工作者、先进基层党组织的通知。
  - 正文已覆盖推荐名额、范围、条件、程序和材料要求。
  - 附件为审批表、汇总表和填写说明；当前无 admitted governance owner target。
  - `notice_capture_route=notice_level_query_only`。
  - 5 个附件均为 `metadata_only`。

### Batch 2 结论

- 30 条中只有 3 条需要附件 quarantine：
  - `355867` 的 3 张班车/接驳车安排图片。
  - `355122` 的 1 张班次表图片。
  - `355549` 的停车红色区域图片仅在需要精确空间边界时 quarantine。
- 7 条 file-release / regulation owner 的 PDF 是 source-truth required bytes。
- 其余 notice-level 查询样本即使附件很多，也应保持 metadata-only。
- 旧 `attachment_processing_policy=process` 在 notice-level query 桶中误伤明显，
  需要被新状态机替换为 notice-first 判定。

## 当前实现缺口

当前 repo 已具备部分粗粒度状态：

- collector run：`started` / `success` / `failed`
- run verification：`verified` / `missing_required_objects`
- attachment storage：`reference_only` / `object_store` / `local`
- attachment provenance：`reference_only` / `collected_internal`
- routing sample：`metadata_only` / `process`

但它还没有完整表达：

- `notice_capture_route`
- `attachment_capture_policy`
- `attachment_capture_state`
- `retention_class`
- `attachment_promotion_state`
- metadata-only attachment 不计入 required source objects 的 manifest / ledger contract

因此首轮验证应先作为 design replay / dry-run report 执行，不能把现有 pending multimodal gap
直接当作正确目标态。
