import assert from "node:assert/strict";
import test from "node:test";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import {
	classifyNotice,
	NOTICE_CLASSIFICATION_RETRY_DELAYS_MS,
	NoticeClassificationInvalidOutputError,
	NoticeClassificationProviderError,
} from "notice-classifier-core/classifier";
import { toModelInput } from "notice-classifier-core/model";

test("uses the model for every notice", async () => {
	const input: NoticeClassificationTask = {
		noticeId: 1,
		noticeTitle: "暂时关闭校园南门",
	};
	let modelCalls = 0;
	const classification = await classifyNotice(input.noticeTitle, async (actual) => {
		modelCalls += 1;
		assert.equal(actual, input.noticeTitle);
		return "unclassified";
	});
	assert.equal(classification, "unclassified");
	assert.equal(modelCalls, 1);
});

test("shares one retry budget across provider and invalid output failures", async () => {
	const input: NoticeClassificationTask = {
		noticeId: 2,
		noticeTitle: "外链通知",
	};
	let attempts = 0;
	const retryDelays: number[] = [];
	assert.equal(
		await classifyNotice(
			input.noticeTitle,
			async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new NoticeClassificationProviderError("temporary gateway failure");
				}
				if (attempts === 2) {
					throw new NoticeClassificationInvalidOutputError("temporary invalid output");
				}
				return "campus_news";
			},
			async (delayMs) => {
				retryDelays.push(delayMs);
			},
		),
		"campus_news",
	);
	assert.equal(attempts, 3);
	assert.deepEqual(retryDelays, [...NOTICE_CLASSIFICATION_RETRY_DELAYS_MS]);
});

test("exhausts retries for repeated invalid output", async () => {
	const input: NoticeClassificationTask = {
		noticeId: 3,
		noticeTitle: "待判断通知",
	};
	let attempts = 0;
	const retryDelays: number[] = [];
	await assert.rejects(
		classifyNotice(
			input.noticeTitle,
			async () => {
				attempts += 1;
				throw new NoticeClassificationInvalidOutputError("invalid structured output");
			},
			async (delayMs) => {
				retryDelays.push(delayMs);
			},
		),
		/model classification failed: invalid structured output/u,
	);
	assert.equal(attempts, 3);
	assert.deepEqual(retryDelays, [...NOTICE_CLASSIFICATION_RETRY_DELAYS_MS]);
});

test("does not retry non-retryable provider or local errors", async () => {
	const input: NoticeClassificationTask = {
		noticeId: 4,
		noticeTitle: "待判断通知",
	};
	for (const failure of [
		new NoticeClassificationProviderError("authentication failed", { retryable: false }),
		new Error("local contract failed"),
	]) {
		let attempts = 0;
		await assert.rejects(
			classifyNotice(input.noticeTitle, async () => {
				attempts += 1;
				throw failure;
			}),
			failure.message,
		);
		assert.equal(attempts, 1);
	}
});

test("sends only the notice title to the model", () => {
	assert.deepEqual(toModelInput("待判断通知"), {
		notice_title: "待判断通知",
	});
});
