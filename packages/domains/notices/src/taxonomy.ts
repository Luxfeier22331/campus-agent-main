export {
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_LABELS,
	NOTICE_FILTER_CATEGORIES,
	type NoticeCategory,
} from "campus-contracts/notices";

import { NOTICE_CATEGORIES, type NoticeCategory } from "campus-contracts/notices";

const NOTICE_CATEGORY_SET = new Set<string>(NOTICE_CATEGORIES);

export const NOTICE_CATEGORY_DESCRIPTIONS = {
	research_affairs: "科研和创新项目的申报、立项、中期、结题、成果填报、科研系统和科研资源服务",
	lectures_forums:
		"学术讲座、论坛、工作坊和知识交流的预告、征稿、议程、参与安排及可唯一识别的命名系列条目",
	teaching_affairs:
		"课程、考试、注册、学籍、专业分流、培养方向、导师双选、专业实习、教学奖励、毕业资格和学位授予",
	student_affairs:
		"学生资助、心理健康、离校，以及军训、社会实践、志愿服务、学生评优、学生组织和学生党建的组织办理事项",
	competitions: "正式竞赛的报名、代表队招募、选拔、赛制、评审、排名、权威名单和奖项结果",
	admissions: "入校招生、录取、推免、报考以及升学和学位阶段的资格选拔",
	international_programs: "留学、交换、公派、境外访学及其宣讲、遴选和候选结果",
	employment:
		"招聘、有偿学生岗位、基层就业项目、实习、选调、岗位津贴、职业趋势、职业指导和就业服务信息",
	campus_operations:
		"校舍设施、开放关闭、空间占用、交通、假期、安全、校医院公共卫生服务、服务上线维护和使用指南",
	human_resources: "教职工招聘、职称、岗位聘用、考核、薪酬税务、福利体检和职业发展办理",
	governance: "党政组织工作、内部部署、制度执行、校务办理和校地校企合作统筹",
	procurement: "采购、招标、比选、成交与合同供应",
	campus_activities:
		"以报名、招募、邀请参与或发布安排为主要用途的文化、艺术、体育、阅读、公益和校园体验活动",
	campus_news:
		"人物报道、综合宣传、成果展示、来访合作，以及没有办理、参与、权威状态或后续动作的纯叙事报道",
	unclassified: "标题不足以判断唯一分类；不得猜测标题没有表达的内容",
} as const satisfies Record<NoticeCategory, string>;

export const NOTICE_CLASSIFICATION_RULES = [
	"分类只依据 notice_title，不依据运行日期或标题所述事项是否已过；同一标题的分类不随时间变化。",
	"根据标题体现的主要用途判断用户需要办理、参与、核验或了解的核心事项；地点、宣传口号和单个主题词不能单独决定分类。",
	"先判断标题是在表达办理、参与、权威状态、结果或可复用服务信息，还是只叙述人物、现场、过程、记忆、风采或宣传成果；只有后者且没有后续动作时归 campus_news。",
	"业务主题本身不能阻止归入 campus_news；只有标题仍明确表达办理要求、参与安排、权威名单或结果、业务状态、后续动作或可复用服务信息时，才保留业务分类。",
	"正式竞赛、招生执行和就业服务规则优先于纯叙事一般规则；不得只因标题含活动、回顾、喜报或宣传表达就忽略明确的业务动作和权威结果。",
	"军训记忆、社会实践启动或纪实、主题党日参访等没有报名、办理、权威状态或后续动作的报道归 campus_news。",
	"具有报名、招募、选拔、组队、参赛、赛制、评审、排名或奖项的正式比赛归 competitions，不因教学、体育或校园活动主题改类。",
	"标题明确写有比赛、大赛或竞赛，并表达报名、组织参赛、选拔、评审或排名时，必须归 competitions，不得归 teaching_affairs、campus_activities 或 human_resources；teaching_affairs 的教学奖励只包括非竞赛性评奖和奖励办理。",
	"正式竞赛的代表队招募、权威名单和结果归 competitions；只叙述比赛现场、人物表现或宣传成果且没有权威结果和后续办理时归 campus_news。",
	"学术讲座、论坛和工作坊的预告、征稿、入选论文或议程名单、日程与参与安排归 lectures_forums；只有现场过程和举办成效的纯叙事回顾归 campus_news。",
	"标题同时给出命名讲堂或论坛、明确期次、具名主讲人和主题，足以归 lectures_forums，不要求同时出现时间、地点或报名。",
	"标题只有讲座或系列名称和宽泛主题、缺少明确期次或具名主讲人，也没有预告、日程和参与安排时，不足以归 lectures_forums；明确是活动回顾时归 campus_news，否则使用 unclassified。",
	"教职工个人的薪酬税务、福利体检、聘用和考核归 human_resources；校园设施与公共服务状态归 campus_operations；要求单位组织、推荐、报送或落实制度归 governance。",
	"各单位报送系统经办人、责任人或内部流程信息归 governance；不能只因流程最终服务学生而归 student_affairs。",
	"科研和创新项目的申报、立项、开题、中期、结题与成果填报属于权威项目状态，归 research_affairs；课程建设、教学改革、导师双选、专业实习部署和教学奖励归 teaching_affairs。",
	"入校、升学和学位阶段资格选拔归 admissions；校内专业分流和培养方向选拔归 teaching_affairs。",
	"标题明确以招生组为执行主体，开展或参加招生宣传、招生咨询和招生座谈时，必须归 admissions，不得归 campus_news；招生和国际项目的宣讲、遴选、权威名单、结果及后续办理保留所属业务分类。",
	"招生或国际项目标题如果只宣传人物、现场和综合成果，且不再体现招生服务、项目执行、权威状态或后续办理，归 campus_news。",
	"招聘、职业趋势、职业指导和就业服务本身提供可复用职业信息，归 employment；只借就业主题宣传人物或活动现场且不再提供就业信息时归 campus_news。",
	"就业工作坊、求职沙龙、招聘宣讲和职业指导及其活动回顾归 employment；不得因圆满举办、活动回顾或现场报道等表达改成 campus_news。",
	"具体有偿岗位从招聘、选聘到津贴或工资发放的完整流程归 employment；勤工助学政策、困难认定和资助资格归 student_affairs。",
	"基层就业学费补偿和国家助学贷款代偿归 student_affairs；基层就业关系是资格条件，不改变补偿代偿这一办理结果。",
	"西部计划等具有明确服务岗位、服务期和招募选拔流程的毕业生基层服务项目归 employment；一般校园志愿服务归 student_affairs。",
	"军训、社会实践、志愿服务、学生荣誉和学生组织评优的报名、组织要求、权威名单、结果和办理事项归 student_affairs；相应纯叙事报道归 campus_news。",
	"毕业资格、学位授予和课程调整归 teaching_affairs；考试本身归 teaching_affairs，考试造成的教室占用、区域避让或开放变化归 campus_operations。",
	"学生体质健康测试成绩、免测和缓测名单归 teaching_affairs；面向师生的疫苗接种、门诊和公共卫生服务安排归 campus_operations；教职工福利体检归 human_resources。",
	"无偿献血等以报名和自愿参与为主要用途的公益活动归 campus_activities，不因举办地点是校医院而归 campus_operations。",
	"作品、短视频、摄影或内容征集只有明确赛制、评审、排名或奖项时才归 competitions；没有这些竞赛机制、主要邀请参与或投稿时归 campus_activities。",
	"应急救护、安全技能和健康科普培训如果提供报名、授课、实操或考核，归 campus_activities；应急处置、风险提醒、封闭安排和服务状态才归 campus_operations。",
	"教职工年度体检、妇科体检和体检报告领取归 human_resources，不因承办或领取地点是校医院而归 campus_operations。",
	"校园设施、开放关闭、空间占用、交通、安全、假期安排和持续服务指南归 campus_operations。",
	"以邀请参加、发布日程或参与安排为主要用途的学术讲座、论坛和工作坊归 lectures_forums；阅读活动、共读、经典精读和观影的报名、招募与参与安排归 campus_activities。",
	"书单、专刊、推文和其他内容上线，如果没有报名、办理或参与安排，归 campus_news，不归 campus_operations 或 campus_activities。",
	"校友联络员推荐和校友组织机制建设归 governance，不因参与者是学生而归 student_affairs。",
	"要求师生或单位持续投稿宣传、履行备案或落实宣传任务归 governance；主题党日、参访和宣传成果的纯叙事报道归 campus_news。",
	"人物、综合宣传、成果展示、来访合作，以及没有办理、参与、权威状态、权威结果或后续动作的活动报道归 campus_news。",
	"校地和校企合作意向征集与业务回顾归 governance；人物宣传或综合合作动态归 campus_news。",
	"标题明确包含通知、预告、报名、招募、征集、遴选、名单、结果或邀请参加等意图时，按对应业务或活动分类。",
	"标题只有宽泛主题、宣传口号或无法唯一识别用途时使用 unclassified；不得猜测标题没有表达的内容。",
] as const;

export function isNoticeCategory(value: unknown): value is NoticeCategory {
	return typeof value === "string" && NOTICE_CATEGORY_SET.has(value);
}
