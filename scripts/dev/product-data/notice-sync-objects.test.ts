import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import type { NoticeSourceRows } from "./notice-sync.ts";
import { copyNoticeSourceClosure } from "./notice-sync-objects.ts";

test("copies selected current and published source closures before exposing refs", async () => {
	const resource = Buffer.from("file");
	const sha256 = createHash("sha256").update(resource).digest("hex");
	const resourceKey = `internal_portal/resources/sha256/${sha256}`;
	const source: InternalPortalNoticeSource = {
		schema_version: "internal_portal_notice_source.v2",
		notice_id: 1,
		notice_type: 5,
		notice_title: "通知",
		organization_id: null,
		notice_release_time: "2026-09-01 10:00",
		is_external: false,
		external_url: null,
		notice_content_html: "<p>正文</p>",
		attachments: [],
		resources: [
			{
				kind: "images",
				ordinal: 0,
				object_key: resourceKey,
				sha256,
				byte_size: resource.length,
				content_type: "image/png",
			},
		],
	};
	const previous = { ...source, notice_title: "旧标题" };
	const ref = noticeSourceRef(source);
	const oldRef = noticeSourceRef(previous);
	const rows: NoticeSourceRows = {
		"notices.notices": [{ notice_id: 1, source_ref: ref, published_source_ref: oldRef }],
		"notices.categories": [],
		"notices.notice_types": [],
		"notices.organizations": [],
	};
	const objects = new Map([
		["internal_portal/meta.json", Buffer.from("{}")],
		[ref, Buffer.from(JSON.stringify(source))],
		[oldRef, Buffer.from(JSON.stringify(previous))],
		[resourceKey, resource],
	]);
	const copied = new Map<string, Uint8Array>();
	const read = async (key: string) => {
		const body = objects.get(key);
		assert.ok(body, key);
		return body;
	};
	const result = await copyNoticeSourceClosure({
		rows,
		read,
		write: async (key, body) => {
			copied.set(key, body);
		},
	});
	assert.equal(result.objects, 4);
	assert.deepEqual([...copied.keys()], ["internal_portal/meta.json", resourceKey, ref, oldRef]);
	objects.set(resourceKey, Buffer.from("changed bytes"));
	await assert.rejects(
		copyNoticeSourceClosure({
			rows,
			read,
			write: async () => {
				/* no write after digest failure */
			},
		}),
		/digest mismatch/,
	);
});
test("an empty date selection copies no objects", async () => {
	const rows: NoticeSourceRows = {
		"notices.notices": [],
		"notices.categories": [],
		"notices.notice_types": [],
		"notices.organizations": [],
	};
	assert.deepEqual(
		await copyNoticeSourceClosure({
			rows,
			read: async () => {
				throw new Error("unexpected read");
			},
			write: async () => {
				throw new Error("unexpected write");
			},
		}),
		{ objects: 0 },
	);
});
