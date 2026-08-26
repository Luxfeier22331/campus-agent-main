import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
	normalizePublishedNoticeContent,
	publishNotices,
	resolveAssetContentType,
} from "../src/publisher.ts";
import type { PublisherObjectStore } from "../src/store.ts";

describe("notice publisher", () => {
	it("succeeds without object-store reads when no notices are pending", async () => {
		const client = fakeClient([{ rows: [] }]);
		const store = fakeStore();
		await expect(
			publishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({ assets: 0, notices: 0 });
		expect(store.getSource).not.toHaveBeenCalled();
	});

	it("rejects an explicit notice without a category", async () => {
		const client = fakeClient([{ rows: [candidate({ category: null })] }]);
		await expect(
			publishNotices({
				client,
				noticeIds: [358159],
				objectStore: fakeStore(),
				portalHost: "my.muc.edu.cn",
			}),
		).rejects.toThrow("notice 358159 has no category");
	});

	it("publishes database candidates without comparing or replacing category", async () => {
		const queries: string[] = [];
		const progress: unknown[] = [];
		const client = {
			query: vi.fn(async (text: string) => {
				queries.push(text);
				if (text.includes("SELECT notice_id::text")) return { rowCount: 1, rows: [candidate()] };
				if (text.includes("UPDATE notices.notices")) return { rowCount: 1, rows: [] };
				if (text.includes("SELECT asset_kind")) return { rowCount: 0, rows: [] };
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		await expect(
			publishNotices({
				client,
				onProgress: (value) => progress.push(value),
				objectStore: fakeStore(),
				portalHost: "my.muc.edu.cn",
			}),
		).resolves.toEqual({ assets: 0, notices: 1 });
		expect(queries).toContain("BEGIN");
		expect(queries).toContain("COMMIT");
		expect(queries.find((text) => text.includes("UPDATE notices.notices"))).not.toContain(
			"category",
		);
		expect(progress).toEqual([
			{ phase: "processing", processed: 0, total: 1 },
			{ phase: "processing", processed: 1, total: 1 },
			{ phase: "writing", processed: 0, total: 1 },
			{ phase: "writing", processed: 1, total: 1 },
			{ phase: "finalizing", processed: 1, total: 1 },
		]);
	});

	it("does not project portal wrapper content for an external notice", () => {
		expect(
			normalizePublishedNoticeContent({
				html: "<p>摘要</p>",
				isExternal: true,
				portalHost: "my.muc.edu.cn",
				title: "外链",
			}),
		).toEqual({ contentHtml: null, contentText: null, images: [] });
	});

	it("uses the filename when storage reports a generic media type", () => {
		expect(resolveAssetContentType("application/octet-stream", "附件.pdf")).toBe("application/pdf");
	});
});

function candidate(overrides: Record<string, unknown> = {}) {
	return {
		category: "campus_operations",
		external_url: null,
		is_external: false,
		is_published: false,
		notice_id: "358159",
		notice_type: 5,
		organization_id: null,
		released_at: "2026-08-11T00:00:00.000Z",
		title: "测试通知",
		...overrides,
	};
}

function fakeClient(results: Array<{ rows: unknown[] }>): PoolClient {
	return {
		query: vi.fn(async () => ({
			rowCount: results[0]?.rows.length ?? 0,
			rows: results.shift()?.rows ?? [],
		})),
	} as unknown as PoolClient;
}

function fakeStore(): PublisherObjectStore {
	return {
		close: vi.fn(),
		createOrVerifyDerived: vi.fn(),
		getSource: vi.fn(async (key: string) => ({
			body: Buffer.from(
				JSON.stringify(
					key.endsWith("meta.json")
						? {
								notice_types: { "5": "办公通知" },
								organizations: {},
								schema_version: "internal_portal_meta.v1",
								updated_at: "2026-08-11T00:00:00.000Z",
							}
						: {
								attachments: [],
								external_url: null,
								is_external: false,
								notice_content_html: "<p>正文</p>",
								notice_id: 358159,
								notice_release_time: "2026-08-11 08:00:00",
								notice_title: "测试通知",
								notice_type: 5,
								organization_id: null,
								schema_version: "internal_portal_notice_source.v2",
							},
				),
			),
			contentType: "application/json",
		})),
	};
}
