import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_LABEL_CATEGORIES } from "campus-contracts/notices";

import { NOTICE_CLASSIFIER_SYSTEM_PROMPT } from "./model.ts";
import {
	createNoticeProtocolClassifier,
	OPENAI_CHAT_COMPLETIONS_PROTOCOL,
	OPENAI_RESPONSES_PROTOCOL,
	TYPESAFE_SYSTEMONE_PROTOCOL,
} from "./protocol.ts";

const INPUT = { noticeTitle: "关于临时关闭校园南门的通知", noticeTypeName: "办公通知" };
const LABEL = { category: "service_info", intent: "notice" };
const LABEL_JSON = JSON.stringify(LABEL);

const CONFIG = {
	apiKey: "secret",
	baseUrl: "https://provider.example/v1",
	fetchImplementation: undefined,
	model: "classifier-model",
};

function respondWith(protocol: string, seen: { body?: unknown }) {
	return async (_input: unknown, init?: RequestInit) => {
		seen.body = JSON.parse(String(init?.body)) as unknown;
		const payload =
			protocol === OPENAI_CHAT_COMPLETIONS_PROTOCOL
				? { choices: [{ message: { content: LABEL_JSON } }] }
				: { output_text: LABEL_JSON };
		return Response.json(payload);
	};
}

test("the responses protocol sends a structured-output request", async () => {
	const seen: { body?: unknown } = {};
	const classifier = createNoticeProtocolClassifier({
		...CONFIG,
		fetchImplementation: respondWith(OPENAI_RESPONSES_PROTOCOL, seen),
		protocol: OPENAI_RESPONSES_PROTOCOL,
	});
	assert.deepEqual(await classifier(INPUT), LABEL);
	const body = seen.body as Record<string, unknown>;
	assert.equal(body.model, "classifier-model");
	assert.deepEqual(body.input, [
		{ content: NOTICE_CLASSIFIER_SYSTEM_PROMPT, role: "system" },
		{ content: "notice_type：办公通知\n标题：关于临时关闭校园南门的通知", role: "user" },
	]);
	assert.ok(body.text);
});

test("the chat completions protocol sends a structured-output request", async () => {
	const seen: { body?: unknown } = {};
	const classifier = createNoticeProtocolClassifier({
		...CONFIG,
		fetchImplementation: respondWith(OPENAI_CHAT_COMPLETIONS_PROTOCOL, seen),
		protocol: OPENAI_CHAT_COMPLETIONS_PROTOCOL,
	});
	assert.deepEqual(await classifier(INPUT), LABEL);
	const body = seen.body as Record<string, unknown>;
	assert.equal(body.model, "classifier-model");
	assert.ok(Array.isArray(body.messages));
	const format = body.response_format as {
		json_schema: { schema: { required: string[] }; strict: boolean };
		type: string;
	};
	assert.equal(format.type, "json_schema");
	assert.equal(format.json_schema.strict, true);
	assert.deepEqual(format.json_schema.schema.required, ["category", "intent"]);
});

test("the system one protocol asks category and intent and reads both choices", async () => {
	const seen: { body?: unknown; path?: string } = {};
	const classifier = createNoticeProtocolClassifier({
		...CONFIG,
		fetchImplementation: async (input: unknown, init?: RequestInit) => {
			seen.body = JSON.parse(String(init?.body)) as unknown;
			seen.path = new URL(String(input)).pathname;
			return Response.json({
				answers: {
					category: { choice: "service_info", confidence: 0.21, type: "choice" },
					intent: { choice: "notice", confidence: 0.9, type: "choice" },
				},
				model: "drex-max",
				usage: { input_tokens: 1081, output_tokens: 157 },
			});
		},
		protocol: TYPESAFE_SYSTEMONE_PROTOCOL,
	});
	// 低置信度不再改写成 unclassified，答案原样落盘。
	assert.deepEqual(await classifier(INPUT), LABEL);
	assert.equal(seen.path, "/v1/systemone");
	const body = seen.body as Record<string, unknown>;
	assert.equal(body.model, "classifier-model");
	assert.deepEqual(body.state, { notice_title: INPUT.noticeTitle, notice_type: "办公通知" });
	const questions = body.questions as Record<string, { criteria: object; type: string }>;
	assert.deepEqual(Object.keys(questions).sort(), ["category", "intent"]);
	assert.equal(questions.category?.type, "choice");
	assert.deepEqual(
		Object.keys(questions.category?.criteria ?? {}).sort(),
		[...NOTICE_LABEL_CATEGORIES].sort(),
	);
});

test("the system one protocol rejects an answer outside the category set", async () => {
	const classifier = createNoticeProtocolClassifier({
		...CONFIG,
		fetchImplementation: async () =>
			Response.json({
				answers: {
					category: { choice: "not-a-category", type: "choice" },
					intent: { choice: "notice", type: "choice" },
				},
				model: "drex-max",
			}),
		protocol: TYPESAFE_SYSTEMONE_PROTOCOL,
	});
	await assert.rejects(classifier(INPUT), (error: Error) => error.name.includes("InvalidOutput"));
});

test("the system one protocol rejects an answer without intent", async () => {
	const classifier = createNoticeProtocolClassifier({
		...CONFIG,
		fetchImplementation: async () =>
			Response.json({
				answers: { category: { choice: "service_info", type: "choice" } },
				model: "drex-max",
			}),
		protocol: TYPESAFE_SYSTEMONE_PROTOCOL,
	});
	await assert.rejects(classifier(INPUT), (error: Error) => error.name.includes("InvalidOutput"));
});

test("provider failures are reported as retryable provider errors", async () => {
	const classifier = createNoticeProtocolClassifier({
		...CONFIG,
		fetchImplementation: async () => new Response("rate limited", { status: 429 }),
		protocol: OPENAI_RESPONSES_PROTOCOL,
	});
	await assert.rejects(
		classifier(INPUT),
		(error: Error & { retryable?: boolean }) =>
			error.name === "NoticeClassificationProviderError" && error.retryable === true,
	);
});
