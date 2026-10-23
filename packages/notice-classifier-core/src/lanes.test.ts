import assert from "node:assert/strict";
import test from "node:test";

import type { NoticeLabel } from "campus-contracts/notices";

import { classifyNoticeByLane, PORTAL_NOTICE_TYPES } from "./lanes.ts";

const { academic, announcement, employment, office, report, research, studentAffairs, teaching } =
	PORTAL_NOTICE_TYPES;

function label(category: NoticeLabel["category"], intent: NoticeLabel["intent"]): NoticeLabel {
	return { category, intent };
}

const CASES: readonly [number, string, NoticeLabel | null][] = [
	// 车道 0：留学跨栏目最先匹配，项目全周期归 international。
	[
		teaching,
		"关于遴选加拿大Mitacs本科生实习合作奖学金项目候选人的通知",
		label("international", "result"),
	],
	[announcement, "关于2025年国家公派留学项目拟录取名单的公示", label("international", "result")],
	[
		teaching,
		"关于邀请参加第十六届国际研究生奖学金信息说明会的通知",
		label("international", "event"),
	],
	[teaching, "关于转发《2026博士生国际招生面试交流会》的通知", label("international", "event")],
	[
		teaching,
		"关于向澳门高校推荐2025/2026学年奖学金硕士研究生的通知",
		label("international", "action"),
	],
	[
		announcement,
		"关于澳门高校2025-2026学年奖学金硕士研究生拟推荐人选的公示",
		label("international", "result"),
	],
	[
		teaching,
		"关于选拔2026年春季学期赴法国里昂第三大学交换学习学生的通知",
		label("international", "action"),
	],

	// 车道 1：公示公告。
	[
		announcement,
		"中央民族大学海淀校区电梯机房及配电室空调维修项目采购结果公示",
		label("procurement", "result"),
	],
	[announcement, "中央民族大学图书馆数据库采购项目比选公告", label("procurement", "action")],
	[
		announcement,
		"法学院关于推荐2026届优秀本科生免试攻读研究生工作实施细则",
		label("application", "action"),
	],
	[
		announcement,
		"关于公示2025年度市委组织部代市委管理党费收支情况的通知",
		label("governance", "result"),
	],
	[announcement, "舞蹈学院符合2025届普通推免条件学生名单公示", label("selection_result", "result")],
	[
		announcement,
		"生命与环境科学学院2026年优秀应届本科生免试攻读研究生的通知",
		label("application", "action"),
	],

	// 车道 2：学术信息。
	[
		academic,
		"我校喜获6项第九届高等学校科学研究优秀成果奖（人文社会科学）",
		label("news", "result"),
	],
	[
		academic,
		"教师午餐沙龙 | 第12期教师午餐沙龙在海淀校区成功举办",
		label("lecture_forum", "result"),
	],
	[academic, "民族学前沿讲座第五讲", label("lecture_forum", "event")],
	[
		academic,
		"【讲座预告】形策课程专题辅导会——《形势与政策》课程特点与要点解析",
		label("training", "event"),
	],
	[
		report,
		"强世功为中华民族共同体学院教职工讲授关于学习贯彻党的二十届三中全会精神专题讲座",
		label("news", "result"),
	],
	[academic, "中央民族大学国家语言资源监测与研究民族语言中心与北京华为开展交流活动", null],

	// 车道 3：活动报道，党建优先，志愿军不算志愿，研讨班不是学术研讨。
	[report, "学校举办第一期 “双带头人”教师党支部书记培训班", label("news", "result")],
	[
		report,
		"生命与环境科学学院党委组织师生党员观影《志愿军：生死存亡之战》",
		label("news", "result"),
	],
	[
		report,
		"招就处举办“简历精雕，职引未来”简历指导与就业规划专题活动",
		label("recruitment", "result"),
	],
	[report, "俄语-中亚语系学子在第七届京津冀高校俄语大赛中喜获佳绩", label("competition", "result")],
	[report, "“2024年华裔杰青北京研修营”来我校参访", label("news", "result")],
	[report, "全国民族地区教育管理干部专题研讨班在我校开班", label("training", "result")],
	[report, "外院学子圆满完成青年交流项目志愿服务工作", label("activity", "result")],
	[report, "2024年宝钢教育奖学金优秀学生奖评审答辩会顺利举行", label("news", "result")],

	// 车道 4：就业信息。
	[employment, "关于2026届毕业生申报就业奖励的通知", null],
	[employment, "MUC“共美”沙龙——考研全程规划辅导课程", label("training", "event")],
	[employment, "2024年暑期一对一职业咨询服务", label("recruitment", "action")],

	// 车道 5：通知类四栏。
	[
		research,
		"教师午餐沙龙预告｜邵六益：从“中国各族人民”到“中国人民”的社会主义塑造",
		label("lecture_forum", "event"),
	],
	[teaching, "教师午餐沙龙预告｜邵六益：从“中国各族人民”到“中国人民”的社会主义塑造", null],
	[teaching, "关于开展2024年度《军事理论》课程重修学生信息统计工作的通知", null],
	[
		office,
		"关于海淀区教委所属事业单位公开招聘考试笔试占用教室的通知",
		label("service_info", "notice"),
	],
	[office, "校医院装修期间简易门诊首周运行情况良好", null],
	[
		studentAffairs,
		"关于确认发放2024年6月研究生助管、助研岗位津贴的通知",
		label("affairs", "action"),
	],
	[teaching, "关于开展2023-2024年度体质健康测试补测的通知", label("examination", "event")],
	[
		teaching,
		"2024第十六届全国大学生广告艺术大赛校级初赛获奖名单公示",
		label("selection_result", "result"),
	],
	[
		teaching,
		"关于组织举办第27届“外研社·国才杯”全国英语辩论赛的通知",
		label("competition", "event"),
	],
	[
		teaching,
		"关于启动中央民族大学第27届研究生支教团招募选拔工作的通知",
		label("application", "action"),
	],
	[office, "关于信息门户升级的通知", label("service_info", "notice")],
	[office, "关于“AI民大”智能应用上线运行的通知", label("service_info", "reference")],
	[
		office,
		"关于校园卡系统升级暨“我的校园卡”功能正式上线的通知",
		label("service_info", "reference"),
	],
	[office, "关于房产管理应用平台试运行的通知", label("service_info", "notice")],
	[teaching, "关于填写线上线下混合式课程调查问卷的通知", null],
	[teaching, "关于开学典礼期间2024级学生课程调整的通知", label("teaching_schedule", "notice")],
	[
		office,
		"关于发布2024年暑期放假、2024—2025学年秋季开学及学校《2024-2025学年校历》的通知",
		label("teaching_schedule", "notice"),
	],
	[teaching, "关于2025年春季学期研究生课程安排的通知", label("teaching_schedule", "notice")],
	[teaching, "关于做好新学期本科教学工作的通知", label("teaching_schedule", "notice")],
	[teaching, "关于公布2024-2025学年第二学期本科课表的通知", label("teaching_schedule", "notice")],
	[teaching, "中央民族大学（中医药康养）微专业开课通知", label("teaching_schedule", "notice")],
	[teaching, "关于协助办理2024级转专业本科学生课程安排事宜的通知", label("affairs", "action")],
	[
		teaching,
		"关于公布2025级本科生第二次转专业接收计划及考试科目的通知",
		label("application", "action"),
	],
	[teaching, "关于2025级本科生第二次转专业考试安排的通知", label("examination", "event")],
	[teaching, "2024-2025学年秋季学期本科教学工作简报（第一期）", label("news", "result")],
	[teaching, "中央民族大学教务简报", label("news", "result")],
	[office, "迎新快报", label("news", "result")],
	[office, "学术不端警示教育简报（第1期）", label("governance", "notice")],
	[teaching, "关于2023级本科生公共体育课网上选课的通知", label("affairs", "action")],
	[office, "关于召开中央民族大学党委“铸牢”专项巡察动员部署会的通知", label("governance", "event")],
	[
		studentAffairs,
		"关于召开2024年“宝钢教育奖学金”评审答辩会的通知",
		label("application", "action"),
	],
	[studentAffairs, "关于做好2024级新生团组织关系转接工作的通知", label("governance", "notice")],
	[office, "关于高性能计算平台使用培训的通知", label("training", "event")],
	[
		teaching,
		"关于开展2023年“道中华”研究生课程建设专项中期检查工作的通知",
		label("affairs", "action"),
	],
	[
		teaching,
		"关于开展2023年度本科生创新训练计划项目“强基计划”中期验收和2024年度“强基计划”立项申报的通知",
		label("application", "action"),
	],
	[
		teaching,
		"关于开展2023年研究生课程建设和教育教学改革立项项目中期检查工作的通知",
		label("affairs", "action"),
	],
	[
		teaching,
		"关于开展2024年度立项入库大学生创业项目结项验收和56创孵化评估工作的通知",
		label("affairs", "action"),
	],
	[
		studentAffairs,
		"关于开展2024年度北京市大中小学思想政治教育一体化研究项目招标工作的通知",
		label("application", "action"),
	],
	[office, "关于征集与西安电子科技大学合作意向的通知", label("governance", "action")],
	[
		studentAffairs,
		"关于2024年毕业生申报北京市边远山区基层就业学费补偿助学贷款代偿的通知",
		label("affairs", "action"),
	],
	[teaching, "关于启动2024年本科生创新训练项目立项申报的通知", label("application", "action")],
	[
		teaching,
		"关于推荐2024届本科生毕业设计（论文）参评北京高校优秀本科毕业设计（论文）工作的通知",
		label("application", "action"),
	],
	[office, "关于个税汇算清缴服务人员进校服务的通知", label("affairs", "action")],
	[
		teaching,
		"【宣讲会】美国麻省理工学院（MIT）—如何构想AI驱动的未来社会与生态",
		label("international", "event"),
	],
	[office, "党委学生工作部、学生处关于办公地点变更的通知", label("service_info", "reference")],
	[
		teaching,
		"双创系列专题讲座预告丨“校长杯”大学生创新大赛校内动员宣讲会",
		label("competition", "event"),
	],
	[office, "关于观摩“中央民族大学第三届管理岗位青年教职工职业能力竞赛”的通知", null],
	[
		teaching,
		"转发《关于征集中国国际大学生创新大赛(2025)吉祥物的公告》",
		label("application", "action"),
	],
	[office, "2025年暑期就业实习实践活动招募报名通知 （第一批）", label("recruitment", "action")],
	[teaching, "关于核定2024年度教师本科教学工作奖励的通知", label("affairs", "action")],
	[office, "关于下达2025年预算批复的通知", label("governance", "notice")],
	[
		teaching,
		"中央民族大学2025年暑期 “知行行动”课程（活动）工作安排",
		label("teaching_schedule", "notice"),
	],
	[teaching, "药学院暑期知行行动课程----“中医药康养”微专业招生", null],
	[teaching, "关于核查2025届本科生学历、学位资格初审结果的通知", label("affairs", "action")],
	[
		teaching,
		"关于开展2024-2025学年第二学期本科课堂教学质量评价工作的通知",
		label("affairs", "action"),
	],
	[office, "关于举办2026年校内硕博研究生招生咨询会的通知", label("application", "event")],
	[studentAffairs, "关于2025年秋季学期本科生勤工助学工作的通知", label("affairs", "action")],
	[teaching, "关于2026届推荐免试研究生二次分配名额的通知", label("application", "action")],
	[
		teaching,
		"关于推荐学生参加第六届联合国机构宣讲咨询活动的通知",
		label("international", "action"),
	],
	[
		studentAffairs,
		"关于开展中央民族大学2025年大学生暑期社会实践成果回收及评优表彰工作的通知",
		label("affairs", "action"),
	],
	[studentAffairs, "关于铁路12306客户端学生优惠资质在线核验的通知", label("affairs", "action")],
	[office, "关于2025年度财务年终工作安排的通知", label("affairs", "action")],
	[office, "关于开通线上办理职称证明的通知", label("affairs", "action")],
	[office, "关于丰台校区开展废旧非机动车集中清理及规范停放管理的通知", label("affairs", "action")],
	[office, "关于2025年离退休教职工体检安排的通知", label("affairs", "action")],
	// 0.3.x 试标收走的标题：名额分配、公费医疗、设立支持项目、教室为考场。
	[
		studentAffairs,
		"关于2023-2024学年本科生国家奖学金名额再次分配的通知",
		label("application", "action"),
	],
	[office, "关于2025年党员发展指标追加名额分配情况的通知", null],
	[office, "2024年12月校医院公费医疗特别通知", label("affairs", "action")],
	[research, "关于设立 “学术专著支持项目”的通知", label("application", "action")],
	[
		research,
		"关于设立“支持青年教师（含博士后）和博士研究生参加国际学术会议项目”的通知",
		label("application", "action"),
	],
	[
		teaching,
		"关于2025年4月11日中央民族大学2025届教师职业能力测试笔试使用文华楼东区部分教室为考场的通知",
		label("service_info", "notice"),
	],
	[office, "关于2025级新生体检及疫苗接种的通知", label("service_info", "notice")],
	[office, "关于户籍室收取各学院2026级新生户口的通知", null],
	// Drex 重判收走的标题：兼职辅导员选聘。
	[office, "关于选聘兼职辅导员的通知", label("recruitment", "action")],
	[studentAffairs, "关于开展2025年兼职辅导员选聘工作的通知", label("recruitment", "action")],
	[announcement, "兼职辅导员（校聘）拟聘用名单公示", label("selection_result", "result")],
	[teaching, "关于2025年春季学期研究生课程期末成绩录入的通知", label("affairs", "action")],
	[
		studentAffairs,
		"关于开展2022级本科毕业生和开展2025-2026年度体测补测的通知",
		label("examination", "event"),
	],
	[
		teaching,
		"关于组织参加2025年（第十一届）全国大学生统计建模大赛的通知",
		label("competition", "event"),
	],
	[studentAffairs, "关于开展就业指导技能培训的通知", label("training", "event")],
	[
		teaching,
		"关于开展2024-2025学年本科毕业论文（设计）上传抽检平台工作的通知",
		label("governance", "action"),
	],
	[studentAffairs, "关于公布《2026年秋季学期学生资助工作安排》的通知", label("affairs", "action")],
	[office, "关于报送本学期未排课教学科研人员情况的通知", label("governance", "action")],
	[office, "工作提示", label("governance", "notice")],
	[office, "关于发布2025年寒假期间学校值班汇总表的通知", label("governance", "notice")],
	[office, "关于开展2026年校内预算编制工作的通知", label("governance", "notice")],
	[office, "关于举办2026年校内预算编制工作培训会的通知", label("training", "event")],
	[
		announcement,
		"中央民族大学2026年度普通高等学校本科专业设置情况公示",
		label("governance", "result"),
	],
];

test("lane rules label strong-signal titles and leave the rest to the model", () => {
	for (const [noticeType, title, expected] of CASES) {
		assert.deepEqual(classifyNoticeByLane(noticeType, title), expected, title);
	}
});

test("unknown portal columns go to the model", () => {
	assert.equal(classifyNoticeByLane(9978, "关于召开校长办公会的通知"), null);
});
