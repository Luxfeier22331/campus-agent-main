import assert from "node:assert/strict";
import test from "node:test";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

import {
	collectObjectKeys,
	createNoticeSourceObjectStoreFromEnv,
	loadNoticeClassificationInputs,
	type NoticeSourceObjectStore,
} from "./source";

test("reads and lists notices from the configured worktree bucket", async (t) => {
	const bucket = "campus-agent-source-wt-test";
	const key = "internal_portal/notices/2.json";
	t.mock.method(S3Client.prototype, "send", async (command: unknown) => {
		if (command instanceof ListObjectsV2Command) {
			assert.equal(command.input.Bucket, bucket);
			return { Contents: [{ Key: key }] };
		}
		assert.ok(command instanceof GetObjectCommand);
		assert.equal(command.input.Bucket, bucket);
		assert.equal(command.input.Key, key);
		return { Body: { transformToString: async () => notice(2, "通知") } };
	});
	const store = createNoticeSourceObjectStoreFromEnv({
		OBJECT_STORE_BUCKET_SOURCE: ` ${bucket} `,
		OBJECT_STORE_ENDPOINT: "http://localhost:9000",
		OBJECT_STORE_SOURCE_ACCESS_KEY: "test",
		OBJECT_STORE_SOURCE_SECRET_KEY: "test",
	});
	try {
		assert.deepEqual(await loadNoticeClassificationInputs(store), [
			{ noticeId: 2, noticeTitle: "通知" },
		]);
	} finally {
		store.close();
	}
});

test("requires an explicit source bucket", () => {
	for (const value of [undefined, "", "   "]) {
		assert.throws(
			() => createNoticeSourceObjectStoreFromEnv({ OBJECT_STORE_BUCKET_SOURCE: value }),
			/OBJECT_STORE_BUCKET_SOURCE is required/u,
		);
	}
});

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

test("loads, validates, and orders title-only notice sources", async () => {
	const store = fakeStore({
		"internal_portal/notices/2.json": notice(2, "活动记录"),
		"internal_portal/notices/5.json": notice(5, "临时关闭校门", {
			notice_content_html: 42,
			notice_type: null,
		}),
	});
	store.listObjectKeys = async () => [
		"internal_portal/notices/_state.json",
		"internal_portal/notices/5.json",
		"internal_portal/notices/2.json",
	];
	assert.deepEqual(await loadNoticeClassificationInputs(store), [
		{ noticeId: 2, noticeTitle: "活动记录" },
		{ noticeId: 5, noticeTitle: "临时关闭校门" },
	]);
});

test("loads selected ids without listing and rejects inconsistent objects", async () => {
	const store = fakeStore({
		"internal_portal/notices/7.json": notice(8, "通知"),
	});
	store.listObjectKeys = async () => {
		throw new Error("list must not be called");
	};
	await assert.rejects(loadNoticeClassificationInputs(store, [7]), /contains notice_id 8/u);
});

test("bounds concurrent source reads while preserving notice order", async () => {
	const objects = {
		"internal_portal/notices/1.json": notice(1, "一"),
		"internal_portal/notices/2.json": notice(2, "二"),
		"internal_portal/notices/3.json": notice(3, "三"),
	};
	const store = fakeStore(objects);
	const getObject = store.getObject.bind(store);
	let active = 0;
	let maximumActive = 0;
	store.getObject = async (key) => {
		active += 1;
		maximumActive = Math.max(maximumActive, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active -= 1;
		return getObject(key);
	};
	const inputs = await loadNoticeClassificationInputs(store, [3, 1, 2], { concurrency: 2 });
	assert.deepEqual(
		inputs.map((value) => value.noticeId),
		[1, 2, 3],
	);
	assert.equal(maximumActive, 2);
	await assert.rejects(
		loadNoticeClassificationInputs(store, [1], { concurrency: 0 }),
		/positive integer/u,
	);
});

test("rejects malformed classification fields", async () => {
	const malformed = fakeStore({
		"internal_portal/notices/1.json": JSON.stringify({ notice_id: 1 }),
	});
	await assert.rejects(loadNoticeClassificationInputs(malformed, [1]), /schema_version/u);

	const invalidTitle = fakeStore({
		"internal_portal/notices/1.json": notice(1, "   "),
	});
	await assert.rejects(loadNoticeClassificationInputs(invalidTitle, [1]), /invalid notice_title/u);
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

function notice(noticeId: number, title: string, extra: Record<string, unknown> = {}): string {
	return JSON.stringify({
		notice_id: noticeId,
		notice_title: title,
		schema_version: "internal_portal_notice_source.v2",
		...extra,
	});
}
