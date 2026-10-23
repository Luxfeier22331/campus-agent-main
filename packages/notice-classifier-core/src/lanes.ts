/**
 * 通知标签重设计的规则车道：按门户栏目 `notice_type` 分流，标题信号足够强的条目由规则直接给出
 * category 与 intent，其余返回 `null` 交给模型。规则顺序与判据见
 * `.agents/notes/proposed/feature/2026-10-21-notice-classification-redesign.md` 第 5 节与第 8 节，命中即停。
 */

import type { NoticeLabel, NoticeLabelCategory, NoticeLabelIntent } from "campus-contracts/notices";

/** 门户栏目编号，取自 `notices.notice_types`。 */
export const PORTAL_NOTICE_TYPES = {
	office: 5,
	teaching: 6,
	research: 8,
	employment: 10,
	announcement: 11,
	studentAffairs: 32,
	report: 36,
	academic: 9980,
} as const;

/**
 * 规则表沿用三段阶段：pending 是尚未发生或待办，再由 `pendingIntent` 按标题与类别拆成 action、event、
 * notice；completed 即 result，lasting 即 reference。
 */
type LanePhase = "pending" | "completed" | "lasting";

interface LaneLabel {
	category: NoticeLabelCategory;
	phase: LanePhase;
}

interface NoticeLaneRule {
	include: RegExp;
	/** 除 `include` 外还必须命中的第二组词。 */
	also?: RegExp;
	exclude?: RegExp;
	noticeTypes?: readonly number[];
	/** `null` 表示命中后转模型。 */
	label: LaneLabel | null | ((title: string) => LaneLabel);
}

const upcoming = (category: NoticeLabelCategory): LaneLabel => ({ category, phase: "pending" });
const completed = (category: NoticeLabelCategory): LaneLabel => ({ category, phase: "completed" });
const lasting = (category: NoticeLabelCategory): LaneLabel => ({ category, phase: "lasting" });

/** 通用阶段规则：只有明确的回顾词才算 completed，裸举办默认 pending。 */
const byEventStatus =
	(category: NoticeLabelCategory) =>
	(title: string): LaneLabel =>
		/成功举办|圆满|回顾|顺利/u.test(title) ? completed(category) : upcoming(category);

/** 办事动作优先：同一标题既是事件又要报名、申报时归 action，错过报名就无法参加。 */
const ACTION_WORDS =
	/报名|报考须知|公告(?!解读)|申报|申请|设立|接收计划|启动|选派|一对一|提交|上传|报送|填报|领取|征集|征稿|缴费|应聘|招聘|招募|聘用|选聘|聘任|推荐|遴选|选拔|注册|办理|确认|预约|采集|核对|核查|认定|报销|退费|自查|填写|登记|申领|兑换|评审|评选|评优|立项|结项|结题|中期检查|验收/u;
const EVENT_WORDS =
	/讲座|讲堂|讲坛|论坛|沙龙|报告会|研讨|工作坊|宣讲|说明会|咨询会|交流会|分享会|答疑会|考试|测试|笔试|面试|竞赛|大赛|比赛|挑战赛|活动|培训|训练营|研修|读书班|演练|运动会|晚会|展览|开幕|典礼|仪式|召开|会议|大会|预告/u;

/** 类别本身已决定读者动作的，不再看标题；讲座类只有报名才算办理，申报辅导讲座仍是参加。 */
const PENDING_CATEGORY_INTENT: Partial<Record<NoticeLabelCategory, NoticeLabelIntent>> = {
	affairs: "action",
	procurement: "action",
	service_info: "notice",
	teaching_schedule: "notice",
};

function pendingIntent(category: NoticeLabelCategory, title: string): NoticeLabelIntent {
	const fixed = PENDING_CATEGORY_INTENT[category];
	if (fixed) {
		return fixed;
	}
	const action = category === "lecture_forum" || category === "news" ? /报名/u : ACTION_WORDS;
	if (action.test(title)) {
		return "action";
	}
	if (EVENT_WORDS.test(title)) {
		return "event";
	}
	return category === "governance"
		? "notice"
		: category === "international" || category === "application"
			? "action"
			: "event";
}

function toNoticeLabel(label: LaneLabel, title: string): NoticeLabel {
	const intent =
		label.phase === "completed"
			? "result"
			: label.phase === "lasting"
				? "reference"
				: pendingIntent(label.category, title);
	return { category: label.category, intent };
}

const STUDY_ABROAD =
	/留学|访学|交换生|公派|合作奖学金|互换奖学金|留学基金|留基委|Mitacs|国（境）外|境外.*项目|赴港澳|赴台|国际组织后备人才|项目宣讲|研学交流|日内瓦|里昂第三大学|国际招生|国际研究生奖学金|澳门高校|赴澳门|联合国|^【[^】]*宣讲会】/u;
const STUDY_ABROAD_COMPLETED = /名单|候选人|人选|资助情况|录取|入选|结业|公示/u;

const PROCUREMENT = /中选|中标|成交|比选|招标|采购|询价|磋商/u;

/** 推免的启动、细则与名额分配是学生申请流程，名单与条件公示走结果公示。 */
const POSTGRAD_RECOMMENDATION: NoticeLaneRule = {
	include: /免试攻读|推免|推荐免试/u,
	exclude: /名单|结果|公示|拟|条件|候选/u,
	label: upcoming("application"),
};

/** 党费收支情况公示是党组织向党员公开的已定结果，不是读者可查的名单。 */
const PARTY_DUES: NoticeLaneRule = { include: /党费收支/u, label: completed("governance") };

const ANNOUNCEMENT_RULES: readonly NoticeLaneRule[] = [
	{
		include: PROCUREMENT,
		label: (title) =>
			/中选|中标|成交|结果/u.test(title) ? completed("procurement") : upcoming("procurement"),
	},
	POSTGRAD_RECOMMENDATION,
	PARTY_DUES,
	{ include: /实施细则|办法|规定|工作方案|实施方案/u, exclude: /结果|公示|名单/u, label: null },
	{ include: /收支情况/u, label: null },
	/** 专业设置情况公示是学校向主管部门报备的已定结果，不是读者可查的名单。 */
	{ include: /专业设置情况/u, label: completed("governance") },
	{
		include: /名单|公示|结果|录取|录用|入选|拟|候选|人选|公告|公布/u,
		label: completed("selection_result"),
	},
];

const ACADEMIC_RULES: readonly NoticeLaneRule[] = [
	{ include: /喜报|喜讯|喜获|荣获|获奖|入选|接收/u, label: completed("news") },
	{ include: /培训|训练营|形势与政策/u, label: byEventStatus("training") },
	{
		include: /讲座|讲堂|讲坛|论坛|沙龙|报告|研讨|工作坊|学术交流|交流会|进课堂|读书|对话会/u,
		label: byEventStatus("lecture_forum"),
	},
];

/** 活动报道车道只决定 category，阶段由 `classifyReport` 统一给出。 */
const REPORT_CATEGORY_RULES: readonly {
	include: RegExp;
	exclude?: RegExp;
	category: NoticeLabelCategory;
}[] = [
	{
		include:
			/党委|党支部|党总支|党员|党建|党日|党纪|党课|入党|统战|团委|团支部|团日|共青团|巡察|廉洁|组织员|双带头人|全会精神/u,
		category: "news",
	},
	{ include: /求职|简历|选岗|秋招/u, category: "recruitment" },
	{
		include: /讲座|讲堂|讲坛|论坛|沙龙|工作坊|研讨/u,
		exclude: /研讨班/u,
		category: "lecture_forum",
	},
	{ include: /赛|杯/u, category: "competition" },
	{ include: /来校|来我校/u, category: "news" },
	{ include: /培训|研修|训练营|行前|研讨班/u, category: "training" },
	{ include: /实践|纪实|志愿|参访/u, category: "activity" },
];

const EMPLOYMENT_RULES: readonly NoticeLaneRule[] = [
	{ include: /申报/u, label: null },
	{ include: /名单|成绩|结果/u, label: completed("selection_result") },
	{ include: /课程|培训|训练营|特训营|考研/u, label: upcoming("training") },
	{ include: /[\s\S]/u, label: upcoming("recruitment") },
];

const INSPECTION = /中期|中检|结项|结题|验收/u;
/** 「立项项目」「立项入库」指已立项的项目，不算新申报。 */
const NEW_APPLICATION = /申报|申请|年度立项(?!入库)/u;

const NOTICE_RULES: readonly NoticeLaneRule[] = [
	{
		noticeTypes: [PORTAL_NOTICE_TYPES.research],
		include: /预告|讲座|讲堂|讲坛|论坛|学术报告|悦享会|邀请函/u,
		exclude: /大赛|竞赛|比赛|培训|征集/u,
		label: byEventStatus("lecture_forum"),
	},
	/** 学期勤工助学工作通知发给用人单位，是岗位申请与薪酬填报，不是招聘。 */
	{ include: /勤工助学工作/u, label: upcoming("affairs") },
	{ include: /信息统计/u, label: null },
	/** 转专业：启动与接收计划是学生申请，考试安排归考试，协助办理课程安排是学院要办的事。 */
	{
		include: /转专业/u,
		exclude: /名单|成绩|公示|面试/u,
		label: (title) =>
			/考试安排/u.test(title)
				? upcoming("examination")
				: /协助办理/u.test(title)
					? upcoming("affairs")
					: upcoming("application"),
	},
	/** 教学工作简报与迎新快报是已发生工作的通报；警示教育简报发给各单位组织学习，留给纪律规则。 */
	{ include: /简报|快报/u, exclude: /警示教育/u, label: completed("news") },
	{ include: /占用教室|使用教室|教室为考场|划定考试区域|封楼/u, label: upcoming("service_info") },
	/** 校历、开课与课程安排是师生会主动查看的教学日程，排在设施服务之前：校历常与放假安排同题。 */
	{
		include:
			/校历|课表|课程调整|停止开课|上下课时间|课程安排|排课|做好.*教学工作|开课(的)?通知|上课通知|教学周安排|知行行动.?课程（活动）/u,
		exclude: /问卷|协助办理|未排课|简报|奖励|报名|公开课|名单/u,
		label: upcoming("teaching_schedule"),
	},
	{
		include:
			/停水|停电|供暖(?!费)|试水|打压|(装修|改造)期间|疫苗|门诊|开放时间|开馆时间|供餐|有害生物|放假.*安排|假期.*(安排|开放)/u,
		exclude: /运行情况/u,
		label: upcoming("service_info"),
	},
	/** 办事部门搬迁后长期有效，读者需要知道去哪办。 */
	{ include: /办公地点变更|办公地点调整/u, label: lasting("service_info") },
	{ include: /助管、助研岗位津贴/u, label: upcoming("affairs") },
	{ include: /勤工助学|学生助理|助教岗位选聘(的)?通知/u, label: upcoming("recruitment") },
	/** 兼职辅导员是有劳务的校内岗位，选聘通知归求职岗位；拟聘用名单由上面的公示规则先收走。 */
	{
		include: /兼职辅导员/u,
		also: /选聘/u,
		exclude: /名单|结果|公示/u,
		label: upcoming("recruitment"),
	},
	{
		include:
			/四、六级|四六级|计算机等级考试|普通话水平测试|考前注意事项|补考|缓考|体质健康测试|体测/u,
		exclude: /名单|成绩|结果/u,
		label: upcoming("examination"),
	},
	PARTY_DUES,
	{
		include: /^关于公布|^关于公示|公示$|名单公布|结果公示/u,
		also: /名单|成绩|结果|候选人|资助情况/u,
		label: completed("selection_result"),
	},
	POSTGRAD_RECOMMENDATION,
	/** 奖学金名额的分配与再分配要学院在期限内用掉名额、组织申请；党员发展指标归党建。 */
	{ include: /名额/u, also: /分配/u, exclude: /党员|名单/u, label: upcoming("application") },
	{
		include: /大赛|竞赛|比赛|挑战赛/u,
		also: /喜报|喜获|佳绩|斩获|获奖[0-9]|成果|最佳成绩|结硕果/u,
		label: completed("competition"),
	},
	/** 赛事动员宣讲、规则解读与经验分享面向参赛者，是竞赛流程的一环。 */
	{
		include: /大赛|竞赛|比赛|挑战赛/u,
		also: /宣讲|分享会|动员会/u,
		exclude: /观摩/u,
		label: upcoming("competition"),
	},
	{
		include: /大赛|竞赛|比赛|挑战赛|技能赛|辩论赛|系列赛/u,
		exclude: /奖励|填报|统计(?!建模)|计划名录|讲座|宣讲|教材|吉祥物|观摩|论文|答疑/u,
		label: upcoming("competition"),
	},
	{ include: /答疑会|自查|课时工作量|培养方案/u, label: null },
	{ include: /助教|西部计划|就业实习/u, label: upcoming("recruitment") },
	/** 校内硕博招生咨询会服务于推免、考研与直博的升学申请。 */
	{ include: /招生咨询会/u, label: upcoming("application") },
	/** 正式上线、启用后长期提供的系统与平台没有时间窗口；试运行、升级维护、暂停有时段。 */
	{
		include: /上线|正式启用/u,
		exclude: /试运行|维护|暂停|停用|安全|预警|调查问卷/u,
		label: lasting("service_info"),
	},
	{
		include: /升级|断网|维护|暂停访问|暂停服务|停用|上线|正式启用|试运行/u,
		exclude: /安全|预警|调查问卷/u,
		label: upcoming("service_info"),
	},
	{ include: /班车|接驳车|通勤/u, exclude: /统计|报送/u, label: upcoming("service_info") },
	{ include: /选课|退补选|重修|补修/u, label: upcoming("affairs") },
	{
		include: /安全稳定|廉洁|八项规定|四风|警示教育|纪律要求|安全隐患|安全检查|实验室安全/u,
		label: upcoming("governance"),
	},
	{
		include: /召开.*会|会议的通知|大会的通知/u,
		exclude: /答辩|评审|答疑|解读|培训|宣讲|说明会/u,
		label: upcoming("governance"),
	},
	{ include: /组织关系/u, label: upcoming("governance") },
	/** 答辩委员会组成与答辩公告的规范是对培养单位的长期管理要求。 */
	{ include: /答辩委员会/u, label: lasting("governance") },
	/** 庆祝节日与纪念日的群众性活动以参与为主；党支部组织的仍归党建。 */
	{ include: /庆祝.*活动/u, exclude: /党支部|党日|支部/u, label: upcoming("activity") },
	/** 专项调查与思想政治状况调查由各单位组织抽样，个人填答的问卷走事务规则。 */
	{ include: /专项调查|状况(滚动)?调查/u, label: upcoming("governance") },
	/** 审核评估的手册与自评报告是迎评工作的长期依据；费用管理办法发布后读者今后报销要按新办法办。 */
	{ include: /审核评估/u, also: /发布|印发/u, label: lasting("governance") },
	{ include: /费.{0,4}管理办法/u, also: /发布|印发/u, label: lasting("affairs") },
	/** 学院组织论文上传抽检平台是单位要办的手续；学期资助工作安排列出学生要办的资助事项。 */
	{ include: /上传抽检平台/u, label: upcoming("governance") },
	{ include: /未排课/u, label: upcoming("governance") },
	/** 标题只有泛称或只布置单位工作的办公事项。 */
	{ include: /^工作提示$|学校值班汇总表|校内预算编制工作的通知/u, label: upcoming("governance") },
	{ include: /学生资助工作安排/u, label: upcoming("affairs") },
	{
		include:
			/学期注册|成绩录入|离校手续|离校系统|报销|公费医疗|扣款|缴费|个人所得税|个税|汇算清缴|核定|困难.*认定|核查.*初审结果|资格审核工作|评教|课堂教学质量评价|学习体验调查|成果回收|优惠资质|财务年终|开通线上办理|废旧非机动车|无主非机动车|体检/u,
		label: upcoming("affairs"),
	},
	{
		include:
			/培训班|读书班|训练营|培训会|专题培训|集中轮训|能力素质培训|操作培训|使用培训|技能培训/u,
		exclude: /招募|申报/u,
		label: upcoming("training"),
	},
	/** 检查结项与新一年度申报并列时，申报是多数读者能参与的机会。 */
	{ include: INSPECTION, also: NEW_APPLICATION, label: upcoming("application") },
	{
		include: INSPECTION,
		exclude: /名单|结果|情况|流程|规范|答辩/u,
		label: upcoming("affairs"),
	},
	{ include: /预算批复/u, label: upcoming("governance") },
	{
		include: /申报|征集/u,
		also: /预算|财政专项|办学条件|集中采购|修缮费|工程类|合作意向|提案|会员代表|工作总结|开展情况|联络人|资源需求|评审专家/u,
		label: upcoming("governance"),
	},
	{
		include: /申报|申请|发放|领取|认定/u,
		also: /补贴|奖励|补助|代偿|补偿|帮扶|激励/u,
		label: upcoming("affairs"),
	},
	{ include: /招标/u, also: /课题|研究项目/u, label: upcoming("application") },
	/** 学校设立或继续设立的支持项目是读者可以申请的机会。 */
	{ include: /设立/u, also: /支持.*项目/u, label: upcoming("application") },
	{ include: /申报|立项|征集/u, exclude: /名单|结果|填报/u, label: upcoming("application") },
	{ include: /招募|选拔|遴选/u, exclude: /名单|结果/u, label: upcoming("application") },
	{
		include: /评选|评审|认定|推荐.*工作|提名/u,
		exclude: /名单|结果/u,
		label: upcoming("application"),
	},
];

const NOTICE_LANE_TYPES: readonly number[] = [
	PORTAL_NOTICE_TYPES.office,
	PORTAL_NOTICE_TYPES.teaching,
	PORTAL_NOTICE_TYPES.research,
	PORTAL_NOTICE_TYPES.studentAffairs,
];

/** 规则命中时返回标签；返回 `null` 表示该通知进入模型车道。 */
export function classifyNoticeByLane(noticeType: number, title: string): NoticeLabel | null {
	const label = laneLabel(noticeType, title);
	return label ? toNoticeLabel(label, title) : null;
}

/** 通知栏目里以报道语陈述已发生活动的标题，与活动报道同样由规则判定。 */
const COMPLETED_REPORT = /^(?!关于).*(顺利开幕|顺利举办|成功举办|圆满|落幕)/u;

function laneLabel(noticeType: number, title: string): LaneLabel | null {
	if (STUDY_ABROAD.test(title)) {
		const isCompleted =
			noticeType === PORTAL_NOTICE_TYPES.report || STUDY_ABROAD_COMPLETED.test(title);
		return isCompleted ? completed("international") : upcoming("international");
	}
	switch (noticeType) {
		case PORTAL_NOTICE_TYPES.announcement:
			return applyRules(ANNOUNCEMENT_RULES, noticeType, title);
		case PORTAL_NOTICE_TYPES.academic:
			return applyRules(ACADEMIC_RULES, noticeType, title);
		case PORTAL_NOTICE_TYPES.report:
			return classifyReport(title);
		case PORTAL_NOTICE_TYPES.employment:
			return applyRules(EMPLOYMENT_RULES, noticeType, title);
		default:
			if (!NOTICE_LANE_TYPES.includes(noticeType)) {
				return null;
			}
			return COMPLETED_REPORT.test(title)
				? classifyReport(title)
				: applyRules(NOTICE_RULES, noticeType, title);
	}
}

function applyRules(
	rules: readonly NoticeLaneRule[],
	noticeType: number,
	title: string,
): LaneLabel | null {
	const rule = rules.find((candidate) => ruleMatches(candidate, noticeType, title));
	if (!rule) {
		return null;
	}
	return typeof rule.label === "function" ? rule.label(title) : rule.label;
}

function ruleMatches(rule: NoticeLaneRule, noticeType: number, title: string): boolean {
	return (
		(rule.noticeTypes?.includes(noticeType) ?? true) &&
		rule.include.test(title) &&
		(rule.also?.test(title) ?? true) &&
		!rule.exclude?.test(title)
	);
}

/** 活动报道全部由规则判定：无主题信号的调研、慰问、仪式、简报归 news。 */
function classifyReport(title: string): LaneLabel {
	const text = title.replaceAll("志愿军", "");
	const phase: LanePhase = /预告|即将|报名/u.test(text) ? "pending" : "completed";
	const rule = REPORT_CATEGORY_RULES.find(
		(candidate) => candidate.include.test(text) && !candidate.exclude?.test(text),
	);
	return { category: rule?.category ?? "news", phase };
}
