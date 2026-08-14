import type { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { SourceCollectorObjectStore } from "../../../src/object-store.js";
import { backfillNoticeResources } from "../src/notice-resource-backfill.js";

const notice = Buffer.from(
	JSON.stringify({
		attachments: [
			{
				notice_annex_id: "1",
				notice_annex_name: "附件.pdf",
				notice_annex_path: "/files/one.pdf",
				suffix: "pdf",
				type: "application/pdf",
			},
		],
		external_url: null,
		is_external: false,
		notice_content_html: '<p>正文<img src="/images/one.png"></p>',
		notice_id: 358159,
		notice_release_time: "2026-08-03 08:00",
		notice_title: "通知",
		notice_type: 5,
		organization_id: "00007",
		schema_version: "internal_portal_notice_source.v2",
	}),
);

describe("notice resource backfill", () => {
	it("reports deterministic missing resources without an API session", async () => {
		const store = createStore();
		await expect(
			backfillNoticeResources({
				dryRun: true,
				noticeIds: [358159],
				objectStore: store.objectStore,
				portalHost: "portal.example.edu",
			}),
		).resolves.toEqual({
			downloaded: 0,
			existing: 0,
			missing: 2,
			mode: "dry_run",
			notices: 1,
			resources: 2,
		});
		expect(store.writes).toEqual([]);
	});

	it("downloads and create-or-verifies source objects", async () => {
		const store = createStore();
		const apiContext = {
			get: vi.fn(async (url: string) => ({
				bodyStream: async function* () {
					yield Buffer.from(url);
				},
				headers: () => ({
					"content-length": url.includes("/download?") ? "79308898" : "1024",
					"content-type": "application/octet-stream",
				}),
				ok: () => true,
				status: () => 200,
				statusText: () => "OK",
				text: async () => "",
			})),
			post: vi.fn(),
		};
		await expect(
			backfillNoticeResources({
				apiContext,
				dryRun: false,
				noticeIds: [358159],
				objectStore: store.objectStore,
				portalHost: "portal.example.edu",
			}),
		).resolves.toMatchObject({ downloaded: 2, missing: 0 });
		expect(apiContext.get).toHaveBeenCalledTimes(2);
		expect(apiContext.get).toHaveBeenNthCalledWith(1, "https://portal.example.edu/images/one.png");
		expect(apiContext.get).toHaveBeenNthCalledWith(
			2,
			"/comsys-portal-notice-web/download?id=1&notice_id=358159",
		);
		expect(store.writes.sort()).toEqual([
			"internal_portal/notices/358159/attachments/0",
			"internal_portal/notices/358159/images/0",
		]);
	});

	it("keeps original source ordinals when editor placeholders are skipped", async () => {
		const store = createStore(
			'<p><img src="/images/one.png"><img src="/static/index/UEditor/themes/default/images/spacer.gif"><img src="/images/two.png"></p>',
		);
		const apiContext = {
			get: vi.fn(async (url: string) => ({
				bodyStream: async function* () {
					yield Buffer.from(url);
				},
				headers: () => ({ "content-length": "1024", "content-type": "image/png" }),
				ok: () => true,
				status: () => 200,
				statusText: () => "OK",
				text: async () => "",
			})),
			post: vi.fn(),
		};
		await backfillNoticeResources({
			apiContext,
			dryRun: false,
			noticeIds: [358159],
			objectStore: store.objectStore,
			portalHost: "portal.example.edu",
		});
		expect(store.writes.sort()).toEqual([
			"internal_portal/notices/358159/attachments/0",
			"internal_portal/notices/358159/images/0",
			"internal_portal/notices/358159/images/2",
		]);
	});
});

function createStore(noticeContentHtml = '<p>正文<img src="/images/one.png"></p>'): {
	objectStore: SourceCollectorObjectStore;
	writes: string[];
} {
	const writes: string[] = [];
	const noticeBytes = Buffer.from(
		JSON.stringify({
			...JSON.parse(notice.toString("utf8")),
			notice_content_html: noticeContentHtml,
		}),
	);
	return {
		objectStore: {
			createOrVerifyObject: vi.fn(),
			async createOrVerifyStream(input) {
				for await (const _chunk of input.body as Readable) {
					// Drain the stream before the temporary file is removed.
				}
				writes.push(input.key);
				return { byteSize: input.byteSize, contentSha256: input.contentSha256 };
			},
			async getObject(input) {
				if (input.key === "internal_portal/notices/358159.json") {
					return noticeBytes;
				}
				throw new Error(`unexpected key: ${input.key}`);
			},
			getObjectIfExists: vi.fn().mockResolvedValue(null),
			putObject: vi.fn(),
			sourceBucket: "campus-agent-source",
		},
		writes,
	};
}
