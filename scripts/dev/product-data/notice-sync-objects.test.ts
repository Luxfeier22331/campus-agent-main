import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import type { NoticeSourceRows } from "./notice-sync.ts";
import {
	copyNoticeSourceClosure,
	type RcloneEndpoint,
	rcloneCopier,
} from "./notice-sync-objects.ts";

function buildFixture() {
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
	return { rows, objects, resourceKey, sha256 };
}

const endpoint: RcloneEndpoint = {
	endpoint: "http://src",
	bucket: "b",
	accessKeyId: "a",
	secretAccessKey: "s",
};

test("copies binaries through the copier and writes each JSON from its single read", async () => {
	const { rows, objects, resourceKey } = buildFixture();
	const batchKeys: string[][] = [];
	const readKeys: string[] = [];
	const written = new Map<string, Uint8Array>();
	const result = await copyNoticeSourceClosure({
		rows,
		read: async (key) => {
			readKeys.push(key);
			const body = objects.get(key);
			assert.ok(body, key);
			return body;
		},
		write: async (key, body) => {
			written.set(key, body);
		},
		source: endpoint,
		target: endpoint,
		copier: async ({ keys }) => {
			batchKeys.push(keys);
			return keys.length;
		},
	});
	assert.deepEqual(batchKeys, [[resourceKey]]);
	assert.ok(!readKeys.includes(resourceKey));
	assert.equal(readKeys.length, new Set(readKeys).size);
	assert.deepEqual([...written.keys()].sort(), [...readKeys].sort());
	for (const [key, body] of written) {
		assert.equal(body, objects.get(key));
	}
	assert.equal(result.objects, 4);
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
			source: endpoint,
			target: endpoint,
			copier: async () => {
				throw new Error("unexpected copy");
			},
		}),
		{ objects: 0 },
	);
});

test("an invalid source ref fails before copying or writing", async () => {
	const { rows, objects } = buildFixture();
	const ref = String(rows["notices.notices"][0]?.source_ref);
	objects.set(ref, Buffer.from(JSON.stringify({ notice_id: 1 })));
	await assert.rejects(
		copyNoticeSourceClosure({
			rows,
			read: async (key) => {
				const body = objects.get(key);
				assert.ok(body, key);
				return body;
			},
			write: async () => {
				throw new Error("unexpected write");
			},
			source: endpoint,
			target: endpoint,
			copier: async () => {
				throw new Error("unexpected copy");
			},
		}),
		/Invalid notice source/,
	);
});

test("rcloneCopier assembles the command and returns the key count", async () => {
	const calls: Array<{
		command: string;
		args: string[];
		env: Record<string, string>;
	}> = [];
	const count = await rcloneCopier(
		{
			keys: ["internal_portal/meta.json", "internal_portal/notices/1.json"],
			source: {
				endpoint: "http://127.0.0.1:9001",
				bucket: "campus-agent-source",
				accessKeyId: "src-ak",
				secretAccessKey: "src-sk",
			},
			target: {
				endpoint: "http://127.0.0.1:9002",
				bucket: "campus-agent-source-wt-1-x",
				accessKeyId: "dst-ak",
				secretAccessKey: "dst-sk",
			},
		},
		{
			rclonePath: "/nix/store/rclone",
			execFile: async (command, args, options) => {
				calls.push({ command, args, env: options.env });
				return { stdout: "", stderr: "" };
			},
		},
	);
	assert.equal(count, 2);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.command, "/nix/store/rclone");
	// Remotes are named references; credentials arrive via env vars, not the command line.
	assert.equal(calls[0]?.args[1], "syncsource:campus-agent-source");
	assert.equal(calls[0]?.args[2], "synctarget:campus-agent-source-wt-1-x");
	const env = calls[0]?.env ?? {};
	assert.equal(env.RCLONE_CONFIG_SYNCSOURCE_TYPE, "s3");
	assert.equal(env.RCLONE_CONFIG_SYNCSOURCE_ENDPOINT, "http://127.0.0.1:9001");
	assert.equal(env.RCLONE_CONFIG_SYNCSOURCE_ACCESS_KEY_ID, "src-ak");
	assert.equal(env.RCLONE_CONFIG_SYNCTARGET_ENDPOINT, "http://127.0.0.1:9002");
	assert.equal(env.RCLONE_CONFIG_SYNCTARGET_SECRET_ACCESS_KEY, "dst-sk");
	assert.ok(calls[0]?.args.includes("--checksum"));
	assert.ok(calls[0]?.args.includes("--transfers"));
	// The files-from list points at a temp file, not the raw key list.
	const filesFromIndex = calls[0]?.args.indexOf("--files-from") ?? -1;
	const listPath = calls[0]?.args[filesFromIndex + 1] ?? "";
	assert.match(listPath, /notice-sync-rclone-/);
});

test("rcloneCopier rejects with a hint when the binary fails", async () => {
	const endpoint: RcloneEndpoint = {
		endpoint: "http://src",
		bucket: "b",
		accessKeyId: "a",
		secretAccessKey: "s",
	};
	await assert.rejects(
		rcloneCopier(
			{ keys: ["k"], source: endpoint, target: endpoint },
			{
				execFile: async () => {
					throw Object.assign(new Error("spawn failed"), { stderr: "not found" });
				},
			},
		),
		/rclone object copy failed/,
	);
});

test("rcloneCopier skips the command entirely for an empty key list", async () => {
	const count = await rcloneCopier(
		{ keys: [], source: endpoint, target: endpoint },
		{
			execFile: async () => {
				throw new Error("must not run");
			},
		},
	);
	assert.equal(count, 0);
});
