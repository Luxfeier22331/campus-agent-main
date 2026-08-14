import assert from "node:assert/strict";
import test from "node:test";

import {
	collectObjectKeys,
	loadNoticeClassificationInputs,
	type NoticeSourceObjectStore,
} from "./source";

test("collects every object-list page", async () => {
	const tokens: Array<string | undefined> = [];
	assert.deepEqual(
		await collectObjectKeys(async (token) => {
			tokens.push(token);
			return token
				? { isTruncated: false, keys: ["second"] }
				: { isTruncated: true, keys: ["first"], nextContinuationToken: "next" };
		}),
		["first", "second"],
	);
	assert.deepEqual(tokens, [undefined, "next"]);
	await assert.rejects(
		collectObjectKeys(async () => ({ isTruncated: true, keys: [] })),
		/continuation token/u,
	);
});

test("loads, validates, derives type names, and orders notice sources", async () => {
	const store = fakeStore({
		"internal_portal/meta.json": meta(),
		"internal_portal/notices/2.json": notice(2, 36, "活动记录", true),
		"internal_portal/notices/5.json": notice(5, 5, "临时关闭校门", false, "<p>正文</p>"),
	});
	store.listObjectKeys = async () => [
		"internal_portal/notices/_state.json",
		"internal_portal/notices/5.json",
		"internal_portal/notices/2.json",
	];
	assert.deepEqual(await loadNoticeClassificationInputs(store), [
		{
			contentText: null,
			isExternal: true,
			noticeId: 2,
			noticeTitle: "活动记录",
			noticeTypeName: "活动报道",
		},
		{
			contentText: "正文",
			isExternal: false,
			noticeId: 5,
			noticeTitle: "临时关闭校门",
			noticeTypeName: "办公通知",
		},
	]);
});

test("loads selected ids without listing and rejects inconsistent objects", async () => {
	const store = fakeStore({
		"internal_portal/meta.json": meta(),
		"internal_portal/notices/7.json": notice(8, 5, "通知", false),
	});
	store.listObjectKeys = async () => {
		throw new Error("list must not be called");
	};
	await assert.rejects(loadNoticeClassificationInputs(store, [7]), /contains notice_id 8/u);
});

test("rejects malformed source contracts and unknown type ids", async () => {
	const malformed = fakeStore({
		"internal_portal/meta.json": meta(),
		"internal_portal/notices/1.json": JSON.stringify({ notice_id: 1 }),
	});
	await assert.rejects(loadNoticeClassificationInputs(malformed, [1]), /violates its contract/u);

	const unknownType = fakeStore({
		"internal_portal/meta.json": meta(),
		"internal_portal/notices/1.json": notice(1, 999, "通知", false),
	});
	await assert.rejects(
		loadNoticeClassificationInputs(unknownType, [1]),
		/unknown notice_type 999/u,
	);
});

function fakeStore(objects: Record<string, string>): NoticeSourceObjectStore {
	return {
		close() {
			// The in-memory test store owns no external resources.
		},
		async getObject(key) {
			const value = objects[key];
			if (value === undefined) {
				throw new Error(`missing ${key}`);
			}
			return value;
		},
		async listObjectKeys() {
			return Object.keys(objects);
		},
	};
}

function meta(): string {
	return JSON.stringify({
		notice_types: { "5": "办公通知", "36": "活动报道" },
		organizations: {},
		schema_version: "internal_portal_meta.v1",
		updated_at: "2026-08-11T00:00:00.000Z",
	});
}

function notice(
	noticeId: number,
	noticeType: number,
	title: string,
	isExternal: boolean,
	content: string | null = null,
): string {
	return JSON.stringify({
		attachments: [],
		external_url: isExternal ? "https://example.edu/notice" : null,
		is_external: isExternal,
		notice_content_html: content,
		notice_id: noticeId,
		notice_release_time: "2026-08-11 08:00:00",
		notice_title: title,
		notice_type: noticeType,
		organization_id: null,
		schema_version: "internal_portal_notice_source.v2",
	});
}
