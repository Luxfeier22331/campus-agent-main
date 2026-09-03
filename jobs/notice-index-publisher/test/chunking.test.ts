import { describe, expect, it } from "vitest";

import { buildNoticeChunks } from "../src/chunking/index.ts";
import {
	NOTICE_CHUNK_DEFINITION,
} from "../src/definitions.ts";
import type { NoticeSource } from "../src/types.ts";
import { assertValidNoticeChunks } from "../src/validation.ts";

describe("notice semantic chunking", () => {
	it("keeps formal secondary sections as separate semantic units", () => {
		const build = buildNoticeChunks(
			source(`导语说明。
一、报名条件
申请人应符合基本要求。
（一）本科生
完成培养方案规定课程。
（二）研究生
已完成开题报告。
二、材料清单
1. 申请表
2. 成绩单`),
		);

		expect(() => assertValidNoticeChunks(build)).not.toThrow();
		expect(build.stats).toMatchObject({ primaryHeadingCount: 2, secondaryHeadingCount: 2 });
		expect(build.chunks).toHaveLength(5);
		expect(build.chunks[0]).toMatchObject({
			content: "导语说明。",
			headingPath: [],
			retrievalText: "测试通知\n导语说明。",
		});
		expect(build.chunks[1]).toMatchObject({
			content: "申请人应符合基本要求。",
			headingPath: ["一、报名条件"],
			retrievalText: "测试通知\n一、报名条件\n申请人应符合基本要求。",
		});
		expect(build.chunks[2]).toMatchObject({
			content: "完成培养方案规定课程。",
			headingPath: ["一、报名条件", "（一）本科生"],
		});
		expect(build.chunks[3]).toMatchObject({
			content: "已完成开题报告。",
			headingPath: ["一、报名条件", "（二）研究生"],
		});
		expect(build.chunks[4]).toMatchObject({
			content: "1. 申请表\n2. 成绩单",
			headingPath: ["二、材料清单"],
		});
		expect(build.chunks[4]?.retrievalText).toBe(
			"测试通知\n二、材料清单\n1. 申请表\n2. 成绩单",
		);
	});

	it("groups unstructured lines around the soft target without overlap", () => {
		const line = "甲".repeat(390);
		const build = buildNoticeChunks(source([line, line, line, line].join("\n")));

		expect(build.chunks).toHaveLength(2);
		expect(build.chunks[0]?.content).toBe([line, line, line].join("\n"));
		expect(build.chunks[1]?.content).toBe(line);
		expect(build.chunks.every((chunk) => [...chunk.content].length <= 1200)).toBe(true);
		expect(NOTICE_CHUNK_DEFINITION.overlapChars).toBe(0);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("splits an oversized line at complete sentence boundaries", () => {
		const first = `${"甲".repeat(700)}。`;
		const second = `${"乙".repeat(700)}。`;
		const third = `${"丙".repeat(700)}。`;
		const build = buildNoticeChunks(source(first + second + third));

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([first, second, third]);
		expect(build.stats).toMatchObject({ hardCutCount: 0, sentenceSplitCount: 2 });
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it.each(["2.72%", "97.51%", "1,000", "12:30", "docs.example.edu", "v1.2.3"])(
		"does not split protected value %s",
		(value) => {
			const build = buildNoticeChunks(source(`${"甲".repeat(810)}${value}${"乙".repeat(900)}`));

			expect(build.chunks.some((chunk) => chunk.content.includes(value))).toBe(true);
			expect(() => assertValidNoticeChunks(build)).not.toThrow();
		},
	);

	it("reports a hard cut only when no structural punctuation exists", () => {
		const build = buildNoticeChunks(source("甲".repeat(1300)));

		expect(build.stats.hardCutCount).toBe(1);
		expect(build.chunks.map((chunk) => [...chunk.content].length)).toEqual([1200, 100]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("demotes sentence-like numbered lines that do not have section bodies", () => {
		const contentText = "一、请各单位按时提交材料。\n二、逾期不再受理。";
		const build = buildNoticeChunks(source(contentText));

		expect(build.headings).toEqual([]);
		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toBe(contentText);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("recognizes a short punctuated section heading before structured items", () => {
		const build = buildNoticeChunks(
			source(
				[
					"六、奖项设置",
					"（一）道德风尚奖",
					"依据文明参赛情况评选。",
					"七、工作要求。",
					"（一）各承办单位明确分工。",
					"八、比赛组织",
					"（一）组织协调组负责统筹。",
				].join("\n"),
			),
		);

		expect(build.headings.map((heading) => heading.text)).toEqual([
			"六、奖项设置",
			"（一）道德风尚奖",
			"七、工作要求。",
			"八、比赛组织",
		]);
		expect(build.chunks.map((chunk) => chunk.headingPath)).toEqual([
			["六、奖项设置", "（一）道德风尚奖"],
			["七、工作要求。"],
			["八、比赛组织"],
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("recognizes spacing-noisy primary headings and numbered list markers", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一 、主办单位",
					"中央民族大学体育运动委员会",
					"二 、 比赛安排",
					"1 . 单项赛",
					"比赛时间为5月18日。",
					"2 .团体赛",
					"比赛时间为5月19日。",
					"三 、工作要求",
					"各参赛队须服从现场安排。",
					"四 、联系方式",
					"联系电话：12345678",
				].join("\n"),
			),
		);

		expect(build.headings.map((heading) => heading.text)).toEqual([
			"一 、主办单位",
			"二 、 比赛安排",
			"三 、工作要求",
			"四 、联系方式",
		]);
		const listParts = build.chunks
			.filter((chunk) => chunk.headingPath[0] === "二 、 比赛安排")
			.flatMap((chunk) => chunk.parts)
			.filter((part) => part.kind === "list-item");
		expect(listParts.map((part) => part.content)).toEqual([
			"1 . 单项赛\n比赛时间为5月18日。",
			"2 .团体赛\n比赛时间为5月19日。",
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps image-only subsection labels out of heading paths", () => {
		const build = buildNoticeChunks(
			source(
				[
					"各位老师、同学们：",
					"现将班车运营安排通知如下：",
					"一、4月27日两校区班车安排",
					"",
					"二、4月28日-5月5日两校区班车及地铁接驳车安排",
					"（一）两校区班车",
					"",
					"（二）地铁接驳车",
					"",
					"丰台校区管委会办公室",
					"2026年4月25日",
				].join("\n"),
			),
		);

		expect(build.headings.map((heading) => heading.text)).toEqual([
			"二、4月28日-5月5日两校区班车及地铁接驳车安排",
		]);
		expect(build.chunks.map((chunk) => chunk.content)).toEqual([
			[
				"各位老师、同学们：",
				"现将班车运营安排通知如下：",
				"一、4月27日两校区班车安排",
			].join("\n"),
			[
				"（一）两校区班车",
				"（二）地铁接驳车\n",
				"丰台校区管委会办公室",
				"2026年4月25日",
			].join("\n"),
		]);
		expect(build.chunks[1]?.headingPath).toEqual([
			"二、4月28日-5月5日两校区班车及地铁接驳车安排",
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("demotes factual parenthesized lines without losing real secondary headings", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、比赛安排",
					"（一）报名办法",
					"通过报名系统提交材料。",
					"（二）比赛地点：中央民族大学丰台校区室外场地",
					"（三）所有运动员只能代表一支队伍参赛，不允许兼项。",
					"（四）资格审查",
					"组委会统一核验报名信息。",
				].join("\n"),
			),
		);

		expect(build.headings.map((heading) => heading.text)).toEqual([
			"一、比赛安排",
			"（一）报名办法",
			"（四）资格审查",
		]);
		expect(
			build.chunks.flatMap((chunk) => chunk.parts).map((part) => part.content),
		).toContain(
			"（二）比赛地点：中央民族大学丰台校区室外场地",
		);
		expect(
			build.chunks.flatMap((chunk) => chunk.parts).map((part) => part.content),
		).toContain(
			"（三）所有运动员只能代表一支队伍参赛，不允许兼项。",
		);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("produces stable identities for the same source", () => {
		const input = source("一、办理方式\n在线填写申请表。\n二、咨询方式\n联系电话：12345678");

		expect(buildNoticeChunks(input)).toEqual(buildNoticeChunks(input));
	});

	it("binds consecutive labels to the first list item instead of orphaning them", () => {
		const build = buildNoticeChunks(
			source("一、申报要求\n任主要学生干部情况：\n本科阶段：\n1. 担任班长\n2. 担任团支书"),
		);

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([
			"任主要学生干部情况：\n本科阶段：\n1. 担任班长\n2. 担任团支书",
		]);
		expect(build.chunks[0]?.retrievalText).toBe(
			"测试通知\n一、申报要求\n任主要学生干部情况：\n本科阶段：\n1. 担任班长\n2. 担任团支书",
		);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps each inline label value as one atomic unit", () => {
		const build = buildNoticeChunks(
			source("一、联系方式\n联系电话：12345678\n联系邮箱：notice@example.edu"),
		);

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toBe("联系电话：12345678\n联系邮箱：notice@example.edu");
		expect(build.chunks[0]?.parts.map((part) => part.content)).toEqual([
			"联系电话：12345678",
			"联系邮箱：notice@example.edu",
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a numbered label with all values until the next sibling item", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、竞赛内容与竞赛规则",
					"1. 竞赛内容：",
					"本科非英语类专业组：大学英语四、六级相关词汇",
					"本科英语类专业组：英语专业四、八级相关词汇",
					"2. 校赛时长：160题，60分钟。",
					"3. 竞赛规则：在规定时间内完成作答。",
				].join("\n"),
			),
		);
		const parts = build.chunks.flatMap((chunk) => chunk.parts);

		expect(parts[0]).toMatchObject({
			content: [
				"1. 竞赛内容：",
				"本科非英语类专业组：大学英语四、六级相关词汇",
				"本科英语类专业组：英语专业四、八级相关词汇",
			].join("\n"),
			kind: "list-item",
		});
		expect(build.chunks.some((chunk) => chunk.content === "1. 竞赛内容：")).toBe(false);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a salutation with its sentence-like introduction", () => {
		const build = buildNoticeChunks(
			source(
				[
					"各教学单位、各位同学：",
					"根据学校本科教学工作安排，现将补考的相关事宜通知如下：",
					"一、参加补考对象",
					"符合条件的学生可申请补考。",
				].join("\n"),
			),
		);

		expect(build.chunks).toHaveLength(2);
		expect(build.chunks[0]).toMatchObject({
			content: "各教学单位、各位同学：\n根据学校本科教学工作安排，现将补考的相关事宜通知如下：",
			headingPath: [],
		});
		expect(build.chunks[1]?.headingPath).toEqual(["一、参加补考对象"]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a labeled numbered condition with all of its nested items", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、申报条件",
					"1.基本条件。",
					"6.同等条件下，满足以下条件之一的，可优先推荐：",
					"（1）获得国家级奖学金；",
					"（2）发表高水平论文；",
					"（3）获得发明专利授权。",
					"7.不得重复申请。",
				].join("\n"),
			),
		);

		expect(build.chunks).toHaveLength(3);
		expect(build.chunks[1]?.content).toBe(
			[
				"6.同等条件下，满足以下条件之一的，可优先推荐：",
				"（1）获得国家级奖学金；",
				"（2）发表高水平论文；",
				"（3）获得发明专利授权。",
			].join("\n"),
		);
		expect(build.chunks[2]?.content).toBe("7.不得重复申请。");
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("preserves direct bracketed facts as sibling list units", () => {
		const build = buildNoticeChunks(
			source(
				[
					"各教学单位：",
					"一、教学组织安排",
					"（1）请各教学单位再次核对课表，确保及时发放给任课教师。",
					"（2）任课教师应提前备课，并按课表时间和地点准时授课。",
					"（3）学生须在规定时间内完成网上选课。",
				].join("\n"),
			),
		);
		const listParts = build.chunks
			.flatMap((chunk) => chunk.parts)
			.filter((part) => part.kind === "list-item");

		expect(listParts.map((part) => part.content)).toEqual([
			"（1）请各教学单位再次核对课表，确保及时发放给任课教师。",
			"（2）任课教师应提前备课，并按课表时间和地点准时授课。",
			"（3）学生须在规定时间内完成网上选课。",
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a direct bracketed process as one semantic unit", () => {
		const contentText = [
			"一、办理流程",
			"（1）首先登录系统填写申请信息。",
			"（2）然后上传证明材料。",
			"（3）提交后等待审核结果。",
		].join("\n");
		const build = buildNoticeChunks(source(contentText));

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toBe(contentText.slice("一、办理流程\n".length));
		expect(build.chunks[0]?.parts.map((part) => part.kind)).toEqual(["text"]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a compact unstructured requirement notice together", () => {
		const contentText = [
			"招聘勤工助学助理，具体要求如下：",
			"1、岗位设置",
			"办公室助理。",
			"2、招聘要求",
			"（1）身体健康；",
			"（2）每周三个半天在岗。",
			"3、应聘",
			"请于8月31日前提交报名表。",
			"咨询电话：12345678",
			"示例学院",
			"2026年1月1日",
		].join("\n");
		const build = buildNoticeChunks(source(contentText));

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toBe(contentText);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps labeled URLs in the same field group", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、报名方式",
					"参与方式一：电脑端报名观看活动网址及二维码：",
					"https://example.edu/desktop",
					"参与方式二：手机端报名观看活动网址及二维码：",
					"https://example.edu/mobile",
				].join("\n"),
			),
		);

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toContain(
			"参与方式一：电脑端报名观看活动网址及二维码：\nhttps://example.edu/desktop",
		);
		expect(build.chunks[0]?.content).toContain(
			"参与方式二：手机端报名观看活动网址及二维码：\nhttps://example.edu/mobile",
		);
		expect(build.chunks[0]?.headingPath).toEqual(["一、报名方式"]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("does not expose topic leads as heading paths", () => {
		const build = buildNoticeChunks(
			source(["一、活动安排", "聚焦研究生科研能力提升开展专题活动。", "请按时参加。"].join("\n")),
		);

		expect(build.chunks[0]?.headingPath).toEqual(["一、活动安排"]);
		expect(build.chunks[0]?.retrievalText).toBe(
			"测试通知\n一、活动安排\n聚焦研究生科研能力提升开展专题活动。\n请按时参加。",
		);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a flat person record together across labeled fields and lists", () => {
		const build = buildNoticeChunks(
				source(
				[
					"一、申报要求",
					"姓名：张三",
					"学院：法学院",
					"专业：数学",
					"主要经历：",
					"1. 参加科研项目",
					"2. 获得奖学金",
					"姓名：李四",
					"学院：理学院",
					"专业：物理",
				].join("\n"),
			),
		);

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([
			[
				"姓名：张三",
				"学院：法学院",
				"专业：数学",
				"主要经历：",
				"1. 参加科研项目",
				"2. 获得奖学金",
			].join("\n"),
			["姓名：李四", "学院：理学院", "专业：物理"].join("\n"),
		]);
		expect(build.chunks[0]?.headingPath).toEqual(["一、申报要求"]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps table headers and logical rows together", () => {
		const build = buildNoticeChunks(
				source(
				[
					"一、申报要求",
					"现将名单公示如下：",
					"序号",
					"姓名",
					"专业",
					"奖项",
					"1",
					"张三",
					"数学",
					"一等奖",
					"2",
					"李四",
					"物理",
					"二等奖",
					"备注：以上结果以正式文件为准。",
				].join("\n"),
			),
		);

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([
			"现将名单公示如下：",
			[
				"序号",
				"姓名",
				"专业",
				"奖项",
				"1",
				"张三",
				"数学",
				"一等奖",
				"2",
				"李四",
				"物理",
				"二等奖",
			].join("\n"),
			"备注：以上结果以正式文件为准。",
		]);
		expect(build.chunks[1]?.headingPath).toEqual(["一、申报要求"]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps quote attribution and closing lines attached to preceding prose", () => {
		const build = buildNoticeChunks(
			source(
				[
					"学生感言正文，介绍参加活动后的收获。",
					"——张三",
					"学院",
					"2026年3月30日",
				].join("\n"),
			),
		);

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toBe(
			"学生感言正文，介绍参加活动后的收获。\n——张三\n学院\n2026年3月30日",
		);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("attaches editorial credits to the preceding article body", () => {
		const first = "甲".repeat(700);
		const second = "乙".repeat(700);
		const build = buildNoticeChunks(
			source([first, second, "供稿：学院分党校", "审核：张三、李四"].join("\n")),
		);

		expect(build.chunks).toHaveLength(2);
		expect(build.chunks[1]?.content).toBe(
			`${second}\n供稿：学院分党校\n审核：张三、李四`,
		);
		expect(build.chunks.some((chunk) => chunk.content.startsWith("供稿："))).toBe(false);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("attaches a short image caption to adjacent body text", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、报名方法",
					"报名登记截止时间为3月14日15:00。",
					"请扫描下方二维码填写报名信息：",
					"二、咨询方式",
					"咨询邮箱：notice@example.edu",
				].join("\n"),
			),
		);

		expect(build.chunks[0]?.content).toBe(
			"报名登记截止时间为3月14日15:00。\n请扫描下方二维码填写报名信息：",
		);
		expect(
			build.chunks.some((chunk) => chunk.content === "请扫描下方二维码填写报名信息："),
		).toBe(false);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("does not drop a leading signature or closing line", () => {
		const build = buildNoticeChunks(
			source("——张三\n学院\n2026年3月30日"),
		);

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.content).toBe("——张三\n学院\n2026年3月30日");
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps secondary sections and their continued numbered items in one primary section", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、办理流程",
					"（一）网上申报",
					"1. 登录系统填写信息。",
					"补充上传证明材料。",
					"2. 提交后等待审核。",
					"（二）结果查询",
					"登录系统查看结果。",
				].join("\n"),
			),
		);

		expect(build.chunks).toHaveLength(2);
		expect(build.chunks[0]?.content).toBe(
			"1. 登录系统填写信息。\n补充上传证明材料。\n2. 提交后等待审核。",
		);
		expect(build.chunks[0]?.headingPath).toEqual(["一、办理流程", "（一）网上申报"]);
		expect(build.chunks[1]?.headingPath).toEqual(["一、办理流程", "（二）结果查询"]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps time and location continuations with their list item", () => {
		const first = "1. 丰台校区\n时间：4月1日 9:00\n地点：丰台校区礼堂";
		const second = "2. 海淀校区\n时间：4月2日 14:00\n地点：海淀校区礼堂";
		const build = buildNoticeChunks(
			source(["一、活动安排", first, second].join("\n")),
			{ algorithm: "notice_test.v1", maxChars: 50, overlapChars: 0, targetChars: 30 },
		);

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([first, second]);
		expect(build.chunks.map((chunk) => chunk.parts.map((part) => part.kind))).toEqual([
			["list-item"],
			["list-item"],
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("packs consecutive short list items but leaves a longer fact independent", () => {
		const first = "1. 提交申请表。";
		const second = "2. 提交成绩单。";
		const third = `3. ${"较长且可独立回答的说明".repeat(12)}。`;
		const build = buildNoticeChunks(
			source(["一、材料要求", first, second, third].join("\n")),
		);

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([
			`${first}\n${second}`,
			third,
		]);
		expect(build.chunks.map((chunk) => chunk.parts.map((part) => part.kind))).toEqual([
			["list-item", "list-item"],
			["list-item"],
		]);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("keeps a long submission instruction, URL, and continuation as body text", () => {
		const contentText = [
			"（一）请于2026年4月20日前扫描二维码完成材料报送并确认提交：",
			"https://example.edu/form",
			"提交后请保留回执。",
		].join("\n");
		const build = buildNoticeChunks(source(contentText));

		expect(build.headings).toEqual([]);
		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]).toMatchObject({ content: contentText, headingPath: [] });
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("treats an empty name label as the start of a person record", () => {
		const build = buildNoticeChunks(
			source(
				["姓名：", "学院：法学院", "专业：法学", "姓名：李四", "学院：理学院"].join(
					"\n",
				),
			),
		);

		expect(build.chunks.map((chunk) => chunk.content)).toEqual([
			"姓名：\n学院：法学院\n专业：法学",
			"姓名：李四\n学院：理学院",
		]);
		expect(build.chunks.every((chunk) => chunk.parts[0]?.kind === "record")).toBe(true);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("builds score rows and keeps table columns only in retrieval text", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、评分标准",
					"具体如下：",
					"分值",
					"标准",
					"5分",
					"完全符合要求",
					"4分",
					"基本符合要求",
				].join("\n"),
			),
		);
		const tableChunk = build.chunks.find((chunk) => chunk.content.startsWith("分值\n标准"));

		expect(tableChunk).toBeDefined();
		expect(tableChunk?.headingPath).toEqual(["一、评分标准"]);
		expect(tableChunk?.content).not.toContain("表格列：");
		expect(tableChunk?.retrievalText).toContain("表格列：分值 / 标准");
		expect(tableChunk?.parts.map((part) => part.content)).toEqual([
			"分值\n标准\n5分\n完全符合要求",
			"4分\n基本符合要求",
		]);
		expect(tableChunk?.parts.every((part) => part.kind === "table-row")).toBe(true);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("does not treat an organization-valued table cell as a table terminator", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、名单公示如下",
					"序号",
					"所在学院",
					"学生姓名",
					"学号",
					"1",
					"理学院",
					"张三",
					"22010001",
					"2",
					"理学院",
					"李四",
					"22010002",
					"公示时间为2026年4月1日至4月7日",
				].join("\n"),
			),
		);
		const tableChunk = build.chunks.find((chunk) => chunk.content.includes("22010002"));

		expect(tableChunk?.content).toContain("2\n理学院\n李四\n22010002");
		expect(build.chunks.map((chunk) => chunk.content)).toContain(
			"公示时间为2026年4月1日至4月7日",
		);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("builds schedule rows and leaves the closing organization outside table rows", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、上课时间",
					"具体如下：",
					"节次",
					"文华楼",
					"理工楼",
					"1-2节",
					"08:00-09:35",
					"08:10-09:45",
					"3-4节",
					"10:00-11:35",
					"10:10-11:45",
					"教务处、研究生院",
					"2026年4月1日",
				].join("\n"),
			),
		);
		const tableChunk = build.chunks.find((chunk) => chunk.content.startsWith("节次\n文华楼"));

		expect(tableChunk?.parts.map((part) => part.kind)).toEqual([
			"table-row",
			"table-row",
			"footer",
		]);
		expect(tableChunk?.parts.at(-1)?.content).toBe(
			"教务处、研究生院\n2026年4月1日",
		);
		expect(tableChunk?.retrievalText).toContain("表格列：节次 / 文华楼 / 理工楼");
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("builds home-and-away table rows with the group label as retrieval context", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、具体赛制如下",
					"甲组",
					"主队",
					"客队",
					"第一盘",
					"一队",
					"二队",
					"第二盘",
					"三队",
					"四队",
				].join("\n"),
			),
		);

		expect(build.chunks).toHaveLength(1);
		expect(build.chunks[0]?.parts.map((part) => part.content)).toEqual([
			"甲组\n主队\n客队\n第一盘\n一队\n二队",
			"第二盘\n三队\n四队",
		]);
		expect(build.chunks[0]?.retrievalText).toContain("表格列：甲组 / 主队 / 客队");
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("uses the supplied maximum when deciding whether table headers need their own piece", () => {
		const build = buildNoticeChunks(
			source(
				[
					"一、评分标准",
					"具体如下：",
					"分值",
					"标准",
					"5分",
					"完全符合课程目标与全部考核要求",
					"4分",
					"基本符合课程目标",
				].join("\n"),
			),
			{ algorithm: "notice_test.v1", maxChars: 20, overlapChars: 0, targetChars: 12 },
		);

		expect(build.definition.maxChars).toBe(20);
		expect(build.chunks.every((chunk) => [...chunk.content].length <= 20)).toBe(true);
		expect(
			build.chunks.some((chunk) =>
				chunk.parts.some((part) => part.kind === "table-header" && part.content === "分值\n标准"),
			),
		).toBe(true);
		expect(() => assertValidNoticeChunks(build)).not.toThrow();
	});

	it("rejects empty content_text so it cannot enter a chunk run", () => {
		expect(() => buildNoticeChunks(source(""))).toThrow("source is invalid");
	});
});

function source(contentText: string): NoticeSource {
	return { contentText, noticeId: "test-notice", title: "测试通知" };
}
