import { describe, expect, it } from "vitest";

import { isLogicalNoticeTableLike, selectBroadReviewSample } from "../src/broad-review/index.ts";
import { sha256 } from "../src/encoding.ts";
import type { NoticeChunk } from "../src/types.ts";

describe("notice broad-review table detection", () => {
	it("recognizes logical table rows even when cell values wrap across lines", () => {
		expect(
			isLogicalNoticeTableLike(
				"2022-2023年度；项目：室外项目；测试时间：5月9日\n" +
					"（9：00-11：00）；测试地点：室外田径场；测试对象：22级毕业生\n" +
					"2023-2024年度；项目：室外项目；测试时间：6月9日\n" +
					"（9：00-11：00）；测试地点：室外田径场；测试对象：23级毕业生",
			),
		).toBe(true);
	});

	it("does not classify a short prose field list as a table", () => {
		expect(isLogicalNoticeTableLike("时间：周一；地点：海淀校区；联系人：李老师")).toBe(false);
	});
});

describe("notice broad-review sampling", () => {
	it("selects 350 unique notices with rare coverage, quota fill, and a deterministic control", () => {
		const notices = Array.from({ length: 420 }, (_, offset) => {
			const id = offset + 1;
			const tags: BroadReviewNoticeFixture["tags"] = [];
			if (id === 401) tags.push("table-like");
			if (id === 402) tags.push("boundary-risk");
			if (id === 403) tags.push("long-unstructured");
			if (id === 404) tags.push("extreme-tiny-chunk");
			if (id === 405) tags.push("near-max-chunk");
			if (id === 406) tags.push("very-long-notice");
			if (id >= 1 && id <= 60) tags.push("same-section-split");
			if (id >= 55 && id <= 120) tags.push("list-heavy");
			if (id >= 121 && id <= 160) tags.push("tiny-heavy");
			if (id >= 161 && id <= 200) tags.push("nested-structure");
			if (id >= 201 && id <= 230) tags.push("time-contact-dense");
			if (id >= 231 && id <= 250) tags.push("many-chunks");
			if (id >= 251 && id <= 270) tags.push("many-primary-sections");
			if (id >= 271 && id <= 285) tags.push("long-notice");
			if (id >= 286 && id <= 300) tags.push("short-notice");
			if (id >= 301 && id <= 320) tags.push("single-chunk");
			return noticeFixture(String(id), tags);
		});

		const first = selectBroadReviewSample(notices);
		const second = selectBroadReviewSample([...notices].reverse());

		expect(second).toEqual(first);
		expect(first.sample).toHaveLength(350);
		expect(new Set(first.sample.map((notice) => notice.noticeId)).size).toBe(350);

		const summary = first.summary as {
			sampleTagCoverage: Record<string, { candidateCount: number; selectedCount: number }>;
			strata: Array<Record<string, unknown>>;
		};
		for (const tag of [
			"table-like",
			"boundary-risk",
			"long-unstructured",
			"extreme-tiny-chunk",
			"near-max-chunk",
			"very-long-notice",
		]) {
			expect(summary.sampleTagCoverage[tag]).toMatchObject({
				candidateCount: 1,
				selectedCount: 1,
			});
		}
		expect(summary.strata).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "random-control", newNoticeCount: 50, target: 50 }),
				expect.objectContaining({ name: "coverage-fill", newNoticeCount: 84, target: 84 }),
			]),
		);
		expect(first.sample.some((notice) => notice.primaryStratum === "random-control")).toBe(true);
	});
});

type BroadReviewNoticeFixture = Parameters<typeof selectBroadReviewSample>[0][number];

function noticeFixture(
	noticeId: string,
	tags: BroadReviewNoticeFixture["tags"],
): BroadReviewNoticeFixture {
	const chunk = syntheticChunk(noticeId);
	return {
		boundaries: [],
		chunks: [chunk],
		metrics: {
			arabicListLineCount: 0,
			boundaryRiskCount: 0,
			cellCount: 0,
			chunkChars: { max: 2, min: 2, p50: 2, p75: 2, p90: 2, p95: 2 },
			chunkCount: 1,
			dateTimeContactSignals: 0,
			lineCount: 1,
			numericCellCount: 0,
			primarySectionCount: 0,
			sameSectionBoundaryCount: 0,
			secondaryHeadingCount: 0,
			shortCellRatio: 0,
			tinyChunkCount: 0,
			totalChars: 2,
		},
		noticeId,
		tags,
		title: `通知${noticeId}`,
	};
}

function syntheticChunk(noticeId: string): NoticeChunk {
	const content = "正文";
	return {
		chunkId: sha256(`${noticeId}\0${content}`),
		chunkIndex: 0,
		content,
		headingPath: [],
		noticeId,
		retrievalText: `通知${noticeId}\n${content}`,
	};
}
