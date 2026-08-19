import assert from "node:assert/strict";
import test from "node:test";

import {
	NOTICE_SOURCE_SCHEMA_VERSION,
	noticeSourceIdFromKey,
	noticeSourceKey,
	parseNoticeClassificationSourceJson,
	validateNoticeIds,
} from "./source.ts";

test("parses only the minimum title classification source fields", () => {
	assert.deepEqual(
		parseNoticeClassificationSourceJson(
			JSON.stringify({
				notice_content_html: 42,
				notice_id: 7,
				notice_title: "临时关闭校园南门",
				notice_type: null,
				schema_version: NOTICE_SOURCE_SCHEMA_VERSION,
			}),
			"internal_portal/notices/7.json",
		),
		{
			notice_id: 7,
			notice_title: "临时关闭校园南门",
			schema_version: NOTICE_SOURCE_SCHEMA_VERSION,
		},
	);
});

test("keeps source keys and validation errors deterministic", () => {
	assert.equal(noticeSourceKey(12), "internal_portal/notices/12.json");
	assert.equal(noticeSourceIdFromKey("internal_portal/notices/_state.json"), null);
	assert.equal(noticeSourceIdFromKey("internal_portal/notices/12.json"), 12);
	assert.throws(
		() => parseNoticeClassificationSourceJson("{}", "internal_portal/notices/12.json"),
		/schema_version/u,
	);
	assert.throws(() => validateNoticeIds([12, 12]), /duplicate notice id/u);
});
