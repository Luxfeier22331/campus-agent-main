import assert from "node:assert/strict";
import test from "node:test";

import { createNoticeModelFetch } from "./openai.ts";

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
