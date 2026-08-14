import assert from "node:assert/strict";
import test from "node:test";
import type { NoticeClassificationInput } from "./classifier";
import { classifyNoticeBatch, parseNoticeIds } from "./cli";
import { resolveNoticeClassifierModelConfig } from "./model";

test("parses repeated notice ids and rejects ambiguous arguments", () => {
	assert.equal(parseNoticeIds([]), undefined);
	assert.deepEqual(
		parseNoticeIds(["--notice-id", "358168", "--notice-id", "358159"]),
		[358168, 358159],
	);
	assert.throws(() => parseNoticeIds(["--notice-id", "0"]), /invalid notice id/u);
	assert.throws(() => parseNoticeIds(["--notice-id", "1", "--notice-id", "1"]), /duplicate/u);
	assert.throws(() => parseNoticeIds(["--unknown", "1"]), /Usage/u);
});

test("constructs the model lazily and reuses it for unmatched notices", async () => {
	let factoryCalls = 0;
	let modelCalls = 0;
	const results = await classifyNoticeBatch(
		[
			input(1, "暂时关闭校园南门", "办公通知"),
			input(2, "待判断甲", "办公通知"),
			input(3, "待判断乙", "办公通知"),
		],
		() => {
			factoryCalls += 1;
			return async () => {
				modelCalls += 1;
				return "unclassified";
			};
		},
	);
	assert.deepEqual(results, [
		{ domain: "campus_operations", notice_id: 1 },
		{ domain: "unclassified", notice_id: 2 },
		{ domain: "unclassified", notice_id: 3 },
	]);
	assert.equal(factoryCalls, 1);
	assert.equal(modelCalls, 2);
});

test("rejects the whole batch when model classification fails", async () => {
	await assert.rejects(
		classifyNoticeBatch([input(9, "待判断", "办公通知")], () => async () => {
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

function input(
	noticeId: number,
	noticeTitle: string,
	noticeTypeName: string,
): NoticeClassificationInput {
	return { contentText: null, isExternal: false, noticeId, noticeTitle, noticeTypeName };
}
