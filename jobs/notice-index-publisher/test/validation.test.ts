import { describe, expect, it } from "vitest";

import { buildNoticeChunks } from "../src/chunking/index.ts";
import { buildValidationReport } from "../src/report/index.ts";
import { assertValidChunkRun, assertValidNoticeChunks } from "../src/validation.ts";

describe("notice chunk validation", () => {
	it("rejects changed retrieval provenance", () => {
		const build = buildNoticeChunks({
			contentText: "一、申请条件\n符合培养要求。",
			noticeId: "1",
			title: "申请通知",
		});
		const invalid = structuredClone(build);
		const chunk = invalid.chunks[0];
		if (!chunk) {
			throw new Error("chunk fixture is missing");
		}
		chunk.retrievalText = "错误来源";

		expect(() => assertValidNoticeChunks(invalid)).toThrow("retrieval text is invalid");
	});

	it("rejects missing source coverage", () => {
		const build = buildNoticeChunks({
			contentText: "正文第一行\n正文第二行",
			noticeId: "1",
			title: "测试通知",
		});
		const invalid = structuredClone(build);
		const chunk = invalid.chunks[0];
		if (!chunk) {
			throw new Error("chunk fixture is missing");
		}
		chunk.bodyRanges = chunk.bodyRanges.slice(1);

		expect(() => assertValidNoticeChunks(invalid)).toThrow("absent from chunks");
	});

	it("rejects duplicate notice and chunk identities", () => {
		const build = buildNoticeChunks({ contentText: "正文", noticeId: "1", title: "通知" });

		expect(() => assertValidChunkRun([build, build])).toThrow("source is duplicated");
	});

	it("reports the semantic diagnostics introduced by the chunk strategy", () => {
		const build = buildNoticeChunks({
			contentText: [
				"一、报名方式",
				"参与方式一：电脑端报名：",
				"https://example.edu/desktop",
				"参与方式二：手机端报名：",
				"https://example.edu/mobile",
			].join("\n"),
			noticeId: "1",
			title: "报名通知",
		});
		const report = buildValidationReport([build]);

		expect(report).toMatchObject({
			footerOnlyChunkCount: 0,
			headingContentDuplicateCount: 0,
			formalHeadingPathViolationCount: 0,
			orphanLabelCount: 0,
			secondaryBoundaryCrossingCount: 0,
			standaloneUrlCount: 0,
		});
	});

	it("does not report a complete introduction ending in a colon as an orphan label", () => {
		const build = buildNoticeChunks({
			contentText: [
				"各教学单位：",
				"根据学校教学安排，现将开学工作通知如下：",
				"一、工作安排",
				"请按要求完成准备。",
			].join("\n"),
			noticeId: "1",
			title: "开学通知",
		});
		const report = buildValidationReport([build]);

		expect(report.orphanLabelCount).toBe(0);
	});

	it("does not report ownership or table diagnostics for intact structured content", () => {
		const builds = [
			buildNoticeChunks({
				contentText: [
					"一、活动安排",
					"1. 丰台校区",
					"时间：4月1日 9:00",
					"地点：丰台校区礼堂",
					"2. 海淀校区",
					"时间：4月2日 14:00",
					"地点：海淀校区礼堂",
				].join("\n"),
				noticeId: "1",
				title: "活动通知",
			}),
			buildNoticeChunks({
				contentText: [
					"（一）请于2026年4月20日前扫描二维码完成材料报送并确认提交：",
					"https://example.edu/form",
					"提交后请保留回执。",
				].join("\n"),
				noticeId: "2",
				title: "材料报送通知",
			}),
			buildNoticeChunks({
				contentText: [
					"一、评分标准",
					"具体如下：",
					"分值",
					"标准",
					"5分",
					"完全符合要求",
					"4分",
					"基本符合要求",
				].join("\n"),
				noticeId: "3",
				title: "评分通知",
			}),
		];
		const report = buildValidationReport(builds);

		expect(report).toMatchObject({
			fieldValueSplitCount: 0,
			listContinuationSplitCount: 0,
			tableHeaderContextMissingCount: 0,
			tableRowSplitCount: 0,
			urlOwnerSplitCount: 0,
		});
	});
});
