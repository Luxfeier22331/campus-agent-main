import assert from "node:assert/strict";
import test from "node:test";

import { NoticeClassificationInvalidOutputError } from "./classifier.ts";
import {
	createNoticeModelFetch,
	createOpenAINoticeModelClassifierWithRawResponse,
} from "./openai.ts";

test("the local OpenAI adapter removes gateway-blocked SDK headers", async () => {
	let received: Headers | undefined;
	const fetchImplementation: typeof fetch = async (_input, init) => {
		received = new Headers(init?.headers);
		return new Response("{}", { status: 200 });
	};

	await createNoticeModelFetch(fetchImplementation)("https://provider.example/v1/responses", {
		headers: {
			"user-agent": "openai-sdk",
			"x-stainless-lang": "typescript",
			authorization: "Bearer secret",
		},
	});

	assert(received);
	assert.equal(received.get("user-agent"), null);
	assert.equal(received.get("x-stainless-lang"), null);
	assert.equal(received.get("authorization"), "Bearer secret");
});

test("the Responses classifier returns the exact raw output used for parsing", async () => {
	const rawResponse = '{"category":"admissions"}';
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		assert.equal(String(input), "https://provider.example/v1/responses");
		assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
		return Response.json({
			created_at: 1,
			error: null,
			incomplete_details: null,
			id: "resp_test",
			metadata: {},
			model: "model-a",
			object: "response",
			output: [
				{
					content: [{ annotations: [], text: rawResponse, type: "output_text" }],
					id: "msg_test",
					role: "assistant",
					status: "completed",
					type: "message",
				},
			],
			status: "completed",
			usage: null,
		});
	};
	try {
		const classifier = createOpenAINoticeModelClassifierWithRawResponse({
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY: "secret",
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL: "https://provider.example/v1",
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL: "model-a",
		});
		assert.deepEqual(await classifier("招生通知"), {
			category: "admissions",
			rawResponse,
		});
	} finally {
		globalThis.fetch = previousFetch;
	}
});

test("the raw Responses classifier preserves invalid output evidence", async () => {
	const rawResponse = "not-json";
	const previousFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		Response.json({
			created_at: 1,
			error: null,
			incomplete_details: null,
			id: "resp_invalid",
			metadata: {},
			model: "model-a",
			object: "response",
			output: [
				{
					content: [{ annotations: [], text: rawResponse, type: "output_text" }],
					id: "msg_invalid",
					role: "assistant",
					status: "completed",
					type: "message",
				},
			],
			status: "completed",
			usage: null,
		});
	try {
		const classifier = createOpenAINoticeModelClassifierWithRawResponse({
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_API_KEY: "secret",
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_BASE_URL: "https://provider.example/v1",
			INTERNAL_NOTICE_CLASSIFIER_OPENAI_MODEL: "model-a",
		});
		await assert.rejects(
			() => classifier("招生通知"),
			(error) =>
				error instanceof NoticeClassificationInvalidOutputError &&
				error.rawResponse === rawResponse,
		);
	} finally {
		globalThis.fetch = previousFetch;
	}
});
