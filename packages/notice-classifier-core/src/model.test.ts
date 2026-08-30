import assert from "node:assert/strict";
import test from "node:test";

import { NOTICE_CATEGORIES } from "campus-contracts/notices";

import { NOTICE_CLASSIFIER_SYSTEM_PROMPT, parseNoticeModelOutput, toModelInput } from "./model.ts";

test("the classifier input contains only the notice title", () => {
	assert.deepEqual(toModelInput("校园活动预告"), {
		notice_title: "校园活动预告",
	});
});

test("the model output is one exact taxonomy category", () => {
	assert.equal(parseNoticeModelOutput('{"category":"campus_activities"}'), "campus_activities");
	assert.throws(
		() => parseNoticeModelOutput('{"category":"campus_activities","reason":"title"}'),
		(error) =>
			error instanceof Error &&
			"rawResponse" in error &&
			error.rawResponse === '{"category":"campus_activities","reason":"title"}',
	);
	assert.throws(
		() => parseNoticeModelOutput('{"category":"not-a-category"}'),
		/model returned an invalid classification: \{"category":"not-a-category"\}/u,
	);
	assert.throws(
		() => parseNoticeModelOutput("not-json"),
		(error) => error instanceof Error && "rawResponse" in error && error.rawResponse === "not-json",
	);
});

test("the prompt exposes the complete bounded taxonomy", () => {
	for (const category of NOTICE_CATEGORIES) {
		assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, new RegExp(category, "u"));
	}
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /只依据 notice_title/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /不得猜测标题没有表达的内容/u);
	assert.match(NOTICE_CLASSIFIER_SYSTEM_PROMPT, /JSON Schema/u);
});
