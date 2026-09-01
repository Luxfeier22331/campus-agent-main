import assert from "node:assert/strict";
import test from "node:test";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import { classifyNoticeBatch } from "notice-classifier-core/batch";
import { resolveNoticeClassifierModelConfig } from "notice-classifier-core/openai";
import {
	DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY,
	parseNoticeIds,
	parseNoticeOptions,
} from "./cli";

test("parses repeated notice ids and rejects ambiguous arguments", () => {
	assert.equal(parseNoticeIds([]), undefined);
	assert.deepEqual(
		parseNoticeIds(["--notice-id", "358168", "--notice-id", "358159"]),
		[358168, 358159],
	);
	assert.throws(() => parseNoticeIds(["--notice-id", "0"]), /invalid notice id/u);
	assert.throws(() => parseNoticeIds(["--notice-id", "1", "--notice-id", "1"]), /duplicate/u);
	assert.throws(() => parseNoticeIds(["--unknown", "1"]), /Usage/u);
	assert.deepEqual(parseNoticeOptions([]), {
		concurrency: DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY,
		noticeIds: undefined,
	});
	assert.deepEqual(parseNoticeOptions(["--concurrency", "2", "--notice-id", "3"]), {
		concurrency: 2,
		noticeIds: [3],
	});
	assert.throws(() => parseNoticeOptions(["--concurrency", "0"]), /invalid concurrency/u);
});

test("constructs the model lazily and reuses it for every notice", async () => {
	let factoryCalls = 0;
	let modelCalls = 0;
	const results = await classifyNoticeBatch(
		[input(1, "暂时关闭校园南门"), input(2, "待判断甲"), input(3, "待判断乙")],
		() => {
			factoryCalls += 1;
			return async () => {
				modelCalls += 1;
				return "unclassified";
			};
		},
	);
	assert.deepEqual(results, [
		{ category: "unclassified", notice_id: 1 },
		{ category: "unclassified", notice_id: 2 },
		{ category: "unclassified", notice_id: 3 },
	]);
	assert.equal(factoryCalls, 1);
	assert.equal(modelCalls, 3);
});

test("bounds model calls and sorts the complete result by notice id", async () => {
	let activeCalls = 0;
	let maximumCalls = 0;
	const results = await classifyNoticeBatch(
		[input(3, "待判断丙"), input(1, "待判断甲"), input(2, "待判断乙")],
		() => async () => {
			activeCalls += 1;
			maximumCalls = Math.max(maximumCalls, activeCalls);
			await new Promise((resolve) => setTimeout(resolve, 5));
			activeCalls -= 1;
			return "campus_operations";
		},
		2,
	);
	assert.equal(maximumCalls, 2);
	assert.deepEqual(
		results.map((result) => result.notice_id),
		[1, 2, 3],
	);
});

test("rejects a non-positive classification concurrency", async () => {
	await assert.rejects(
		classifyNoticeBatch([input(1, "待判断")], () => async () => "unclassified", 0),
		/classification concurrency must be a positive integer/u,
	);
});

test("rejects the whole batch when model classification fails", async () => {
	await assert.rejects(
		classifyNoticeBatch([input(9, "待判断")], () => async () => {
			throw new Error("provider unavailable");
		}),
		/notice 9 model classification failed: provider unavailable/u,
	);
});

test("requires explicit model configuration", () => {
	assert.throws(
		() => resolveNoticeClassifierModelConfig({}),
		/INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY/u,
	);
	assert.deepEqual(
		resolveNoticeClassifierModelConfig({
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY: "key",
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL: "https://model.example/v1",
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL: "model",
		}),
		{ apiKey: "key", baseUrl: "https://model.example/v1", model: "model" },
	);
});

function input(noticeId: number, noticeTitle: string): NoticeClassificationTask {
	return { noticeId, noticeTitle };
}
