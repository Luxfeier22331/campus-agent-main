import { describe, expect, it } from "vitest";

import {
	isNoticeCategory,
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_DESCRIPTIONS,
	NOTICE_CLASSIFICATION_RULES,
} from "../src/taxonomy.ts";

describe("notice taxonomy", () => {
	it("defines every single category and its decision rules", () => {
		expect(Object.keys(NOTICE_CATEGORY_DESCRIPTIONS)).toEqual([...NOTICE_CATEGORIES]);
		expect(NOTICE_CATEGORIES).toContain("research_affairs");
		expect(NOTICE_CATEGORIES).toContain("campus_news");
		expect(NOTICE_CATEGORIES).toContain("campus_activities");
		expect(NOTICE_CATEGORIES).not.toContain("general_campus");
		expect(isNoticeCategory("procurement")).toBe(true);
		expect(isNoticeCategory("news_report")).toBe(false);
		expect(NOTICE_CLASSIFICATION_RULES.length).toBeGreaterThan(0);
	});

	it("defines stable purpose-based boundaries instead of relative time state", () => {
		const contract = [
			...Object.values(NOTICE_CATEGORY_DESCRIPTIONS),
			...NOTICE_CLASSIFICATION_RULES,
		].join("\n");

		expect(contract).toContain("不依据运行日期或标题所述事项是否已过");
		expect(contract).toContain("同一标题的分类不随时间变化");
		expect(contract).not.toMatch(/尚未发生|已发生事项|未来的文体|未来讲座/u);
	});

	it("defines the reviewed category boundaries", () => {
		const rules = NOTICE_CLASSIFICATION_RULES.join("\n");

		expect(rules).toContain("业务主题本身不能阻止归入 campus_news");
		expect(rules).toContain("军训记忆、社会实践启动或纪实、主题党日参访");
		expect(rules).toContain("代表队招募、权威名单和结果归 competitions");
		expect(rules).toContain("必须归 competitions，不得归 teaching_affairs");
		expect(rules).toContain("教学奖励只包括非竞赛性评奖和奖励办理");
		expect(rules).toContain("正式竞赛、招生执行和就业服务规则优先于纯叙事一般规则");
		expect(rules).toContain("命名讲堂或论坛、明确期次、具名主讲人和主题");
		expect(rules).toContain("缺少明确期次或具名主讲人");
		expect(rules).toContain("校内专业分流和培养方向选拔归 teaching_affairs");
		expect(rules).toContain("薪酬税务、福利体检、聘用和考核归 human_resources");
		expect(rules).toContain("科研和创新项目的申报、立项、开题、中期、结题与成果填报");
		expect(rules).toContain("入选论文或议程名单、日程与参与安排归 lectures_forums");
		expect(rules).toContain("职业趋势、职业指导和就业服务本身提供可复用职业信息");
		expect(rules).toContain("以招生组为执行主体");
		expect(rules).toContain("必须归 admissions，不得归 campus_news");
		expect(rules).toContain("就业工作坊、求职沙龙、招聘宣讲和职业指导及其活动回顾");
		expect(rules).toContain("经典精读和观影的报名、招募与参与安排归 campus_activities");
		expect(rules).toContain("书单、专刊、推文和其他内容上线");
		expect(rules).toContain("校友联络员推荐和校友组织机制建设归 governance");
		expect(rules).toContain("持续投稿宣传、履行备案或落实宣传任务归 governance");
		expect(rules).toContain("基层就业学费补偿和国家助学贷款代偿归 student_affairs");
		expect(rules).toContain("系统经办人、责任人或内部流程信息归 governance");
		expect(rules).toContain("考试造成的教室占用、区域避让或开放变化归 campus_operations");
		expect(rules).toContain("军训、社会实践、志愿服务、学生荣誉和学生组织评优的报名");
		expect(rules).toContain("津贴或工资发放的完整流程归 employment");
		expect(rules).toContain("毕业生基层服务项目归 employment");
		expect(rules).toContain("学生体质健康测试成绩、免测和缓测名单归 teaching_affairs");
		expect(rules).toContain("疫苗接种、门诊和公共卫生服务安排归 campus_operations");
		expect(rules).toContain("无偿献血等以报名和自愿参与为主要用途的公益活动归 campus_activities");
		expect(rules).toContain("作品、短视频、摄影或内容征集只有明确赛制");
		expect(rules).toContain("主要邀请参与或投稿时归 campus_activities");
		expect(rules).toContain("应急救护、安全技能和健康科普培训");
		expect(rules).toContain("体检报告领取归 human_resources");
		expect(rules).not.toContain("核心业务的回顾保留所属业务分类");
		expect(rules).not.toContain("学生社会实践、志愿服务、学生荣誉和学生组织评优归 student_affairs");
	});
});
