import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildNoticeChunks } from "../src/chunking/index.ts";
import type { NoticeSource } from "../src/types.ts";
import { assertValidNoticeChunks } from "../src/validation.ts";

const sources: NoticeSource[] = JSON.parse(
	readFileSync(new URL("./fixtures/notice-boundaries.json", import.meta.url), "utf8"),
);
function build(id: string) {
	const source = sources.find((source) => source.noticeId === id);
	if (!source) throw new Error(`Missing fixture ${id}`);
	return buildNoticeChunks(source);
}
function together(id: string, value: string, context: string) {
	const chunks = build(id).chunks.filter((chunk) => chunk.content.includes(value));
	expect(chunks.length, `${id}: missing ${value}`).toBeGreaterThan(0);
	for (const chunk of chunks) expect(chunk.retrievalText, `${id}: ${value}`).toContain(context);
}

describe("published notice boundary regressions", () => {
	it.each([
		["（一）按时报送相关评选材料", "（二）规范准确填写、打印"],
		["（一）全体党委委员、纪委委员（由党委办公室、纪委办公室负责组织）", "（二）其他参会人员"],
	])("does not promote an instruction or attendee list to a phase: %s", (first, second) => {
		const result = buildNoticeChunks({
			noticeId: "not-a-phase", title: "工作通知",
			contentText: `一、工作安排\n${first}\n请认真核对。\n${second}\n1.核对内容。\n2.保留记录。`,
		});
		assertValidNoticeChunks(result);
		expect(result.headings.map(h => h.text)).not.toContain(first);
	});
	it.each([
		["356776", "（六）纸质材料提交（9月1—7日）"],
		["358295", "（六）纸质材料接收（11月16日—11月26日）"],
	])("keeps paper material continuations in their own phase in %s", (id, phase) => {
		const chunks = build(id).chunks.filter(c => c.content.includes("（6）经费审计报告"));
		expect(chunks.length).toBeGreaterThan(0);
		for (const chunk of chunks) {
			expect(chunk.retrievalText).toContain(phase);
			expect(chunk.retrievalText).not.toContain("（五）基金办组织验收");
		}
		together("356776", "1.北京市自然科学基金项目研究工作总结报告", "(一）网上填报材料（6月1日—7月10日12:00）");
	});
	it("does not label a later independent paragraph with the first paragraph's field", () => {
		const chunk = build("248133").chunks.find(c => c.content.startsWith("参赛作品仅允许"));
		expect(chunk).toBeDefined();
		expect(chunk!.retrievalText).not.toContain("关于常规赛道：");
		expect(chunk!.retrievalText).not.toContain("关于实战赛道：");
	});
	it("keeps report facts together and identifies oversized report continuations", () => {
		const chunks = build("246044").chunks;
		const third = chunks.find(c => c.content.includes("3，报告题目：哈密顿系统周期轨道的多重性"));
		expect(third?.retrievalText).toContain("报告人：段华贵");
		expect(third?.retrievalText).toContain("10:05-10:50");
		expect(third?.retrievalText).not.toContain("09:15-10:00");
		const second = chunks.filter(c => c.content.includes("09:15-10:00") || c.content.includes("张志涛"));
		expect(second.length).toBeGreaterThan(0);
		for (const chunk of second) {
			expect(chunk.retrievalText).toContain("2，报告题目： Henon-Lane-Emden conjecture and related Schrodinger systems");
			expect(chunk.retrievalText).not.toContain("3，报告题目");
		}
	});
	it("carries track eligibility across group headings and ends it at the next primary section", () => {
		const chunks = build("356868").chunks;
		const redIntro = "“青年红色筑梦之旅”各组别具体参赛条件如下：";
		for (const value of ["1.参赛项目不以营利为目标", "1.参赛项目基于专业和学科背景", "1.参赛项目以商业手段解决"]) {
			const chunk = chunks.find(c => c.content.includes(value));
			expect(chunk?.retrievalText).toContain(redIntro);
			expect(chunk?.retrievalText).toContain("“红旅”赛道参赛申报人须为项目负责人");
			expect(chunk?.retrievalText).not.toContain("主赛道各组别具体参赛条件如下");
		}
		const main = chunks.find(c => c.content.includes("企业法定代表人在大赛通知发布之日后"));
		expect(main?.retrievalText).toContain("主赛道各组别具体参赛条件如下");
		expect(main?.retrievalText).not.toContain(redIntro);
		for (const chunk of chunks.filter(c => c.headingPath[0] === "三、赛制流程")) {
			expect(chunk.retrievalText).not.toContain(redIntro);
			expect(chunk.retrievalText).not.toContain("主赛道各组别具体参赛条件如下");
		}
	});
	it("retains an inline field only while continuing that same source line", () => {
		const result = buildNoticeChunks({
			noticeId: "inline-continuation", title: "提交说明",
			contentText: `关于实战赛道：${"提交项目材料。".repeat(260)}\n所有作品以首次提交版本评审。`,
		});
		assertValidNoticeChunks(result);
		for (const chunk of result.chunks.filter(c => c.content.includes("提交项目材料")))
			expect(chunk.retrievalText).toContain("关于实战赛道：");
	});
	it("keeps a person's name, rather than just the name label, in long record continuations", () => {
		const result = buildNoticeChunks({
			noticeId: "record",
			title: "人员公示",
			contentText: `1.姓名：张三\n研究成果：\n${"研究项目成果。".repeat(250)}\n2.姓名：李四\n研究成果：数学。`,
		});
		assertValidNoticeChunks(result);
		for (const chunk of result.chunks.filter((chunk) => chunk.content.includes("研究项目成果"))) {
			expect(chunk.retrievalText).toContain("1.姓名：张三");
			expect(chunk.retrievalText).not.toContain("李四");
		}
	});
	it.each([
		["244736", "2024年9月6日", "（二）报送时间及形式", "（一）报送材料内容"],
		["357596", "windows平台", "(二)作品提交形式", "(一)参赛作品类别"],
	])(
		"keeps action-word noun headings with their own children in %s",
		(id, value, heading, previous) => {
			const chunk = build(id).chunks.find((chunk) => chunk.content.includes(value));
			expect(chunk?.headingPath).toContain(heading);
			expect(chunk?.retrievalText).not.toContain(previous);
		},
	);
	it("ends a peer list run before a parent with numbered children", () => {
		const result = build("357400");
		const child = result.chunks.find((chunk) => chunk.content.includes("年龄不超过35周岁"));
		expect(child?.retrievalText).toContain("高校思政课教学研究青年项目");
		expect(child?.content).not.toContain("（二）每位申请人");
	});
	it("keeps source conditions above a numbered list and excludes the next peer", () => {
		const result = buildNoticeChunks({
			noticeId: "condition",
			title: "项目验收",
			contentText:
				"一、验收\n成果须至少满足以下要求中的一项：\n1.提交研究报告。\n2.发表论文。\n二、联系方式\n联系办公室。",
		});
		for (const chunk of result.chunks.filter(
			(c) => c.content.includes("研究报告") || c.content.includes("发表论文"),
		))
			expect(chunk.retrievalText).toContain("成果须至少满足以下要求中的一项");
		expect(result.chunks.at(-1)?.retrievalText).not.toContain("成果须至少满足");
	});
	it("preserves long field ownership without interpreting clocks and semicolon prose as structure", () => {
		const contentText = `一、活动\n【项目费用】\n本科生：100美元\n硕士：200美元\n说明：${"说明正文。".repeat(280)}\n二、安排\n上午 8:30-11:30\n提前报名；当天到场；结束离开。`;
		const result = buildNoticeChunks({ noticeId: "long-field", title: "活动说明", contentText });
		assertValidNoticeChunks(result);
		for (const chunk of result.chunks.filter((c) => c.content.includes("说明正文")))
			expect(chunk.retrievalText).toContain("说明：");
		expect(result.chunks.flatMap((c) => c.parts).some((p) => p.kind?.startsWith("table"))).toBe(
			false,
		);
		expect(result.chunks.at(-1)?.content).toContain("上午 8:30-11:30");
	});
	it("does not attach a QR label to a different formal section", () => {
		const result = buildNoticeChunks({
			noticeId: "qr",
			title: "宣讲会",
			contentText: "一、第一项目\n【扫码报名宣讲会】\n二、第二项目\n场一：周一上午",
		});
		expect(result.chunks.find((c) => c.content.includes("周一上午"))?.retrievalText).not.toContain(
			"扫码报名",
		);
	});
	it.each(sources)("preserves source and bounds evidence for $noticeId", (source) => {
		const result = buildNoticeChunks(source);
		assertValidNoticeChunks(result);
		for (const chunk of result.chunks) {
			const evidence = chunk.retrievalText.slice(source.title.length + 1);
			expect([...evidence].length).toBeLessThanOrEqual(1200);
		}
	});
	it.each([
		["355214", "学费约2.1万美元", "【项目费用】"],
		["354372", "50间房间", "【住宿预订】"],
		["245266", "上午 8:30", "9月2-3日"],
		["246048", "上午 9:00", "10月10-11日"],
		["245608", "研究生评审答辩时间", "2024年9月18日"],
		["245902", "上午场8:45", "2024年9月30日"],
		["245902", "上午9:00", "2024年9月30日"],
		["348813", "第一场答辩时间", "2025年4月8日"],
		["349629", "9:00 开班仪式", "5月7日"],
		["348670", "四周：7,580英镑", "英国牛津大学伍斯特学院"],
		["355696", "工作周期：5月至9月", "第二批："],
		["355696", "工作周期：9月至次年1月", "第三批、第四批："],
		["248235", "周一至周五", "No.2 招聘要求"],
		["248235", "名额有限，招满为止", "No.4 特别说明"],
		["357400", "2.提供获奖证书", "高校思政课教学案例研究项目"],
		["348460", "会议全面总结过往工作成果", "台盟小组负责人 陈京："],
		["351117", "DiSG: A Discourse", "论文标题："],
		["351117", "Ti-MISO：基于TiLamb", "论文题目："],
	])("keeps %s value %s with context", together);
	it("does not label autumn graduation arrangements as spring", () => {
		const chunks = build("355696").chunks.filter((c) => c.content.includes("12月中旬"));
		expect(chunks.length).toBeGreaterThan(0);
		for (const chunk of chunks) {
			expect(chunk.headingPath.join("\n")).toContain("秋季批次");
			expect(chunk.retrievalText).not.toContain("春季批次");
		}
	});
	it.each(["246977", "247693", "352741", "355705", "355829"])(
		"keeps table columns on every row in %s",
		(id) => {
			const result = build(id);
			const header = result.source.contentText
				.split("\n")
				.find((line) => line.startsWith("序号；"))!;
			const rows = result.source.contentText.split("\n").filter((line) => /^\d+；/u.test(line));
			expect(rows.length).toBeGreaterThan(1);
			for (const row of rows) {
				const chunk = result.chunks.find((c) => c.content.includes(row));
				expect(chunk?.retrievalText).toContain(header);
			}
		},
	);
});
