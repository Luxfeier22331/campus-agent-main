import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
	normalizePublishedNoticeContent,
	publishNotices,
	republishNotices,
	resolveAssetContentType,
} from "../src/publisher.ts";
import type { PublisherObjectStore } from "../src/store.ts";

describe("notice publisher", () => {
	it("isolates invalid source data and still commits the next notice", async () => {
		const database = { query: vi.fn(async (sql: string) => {
			if (sql.includes("SELECT notice_id::text")) return { rows: [candidate({ notice_id: "1" }), candidate()], rowCount: 2 };
			return { rows: [], rowCount: 1 };
		}) } as unknown as PoolClient;
		const store = fakeStore();
		const get = store.getSource;
		store.getSource = async (key) => key.endsWith("/1.json") ? { body: Buffer.from("broken json"), contentType: "application/json" } : get(key);
		expect(await publishNotices({ client: database, objectStore: store, portalHost: "my.muc.edu.cn" })).toEqual({ assets: 0, notices: 1, failed: 1, outcome: "partial" });
		expect(database.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notices.processing_failures"), expect.arrayContaining([1, "publication", "NoticePublicationDataError"]));
		expect(database.query).toHaveBeenCalledWith("COMMIT");
	});

    it("records a missing notice source as an item failure", async () => {
        const database = fakeClient([{ rows: [candidate()] }]);
        const store = fakeStore();
        const get = store.getSource;
        store.getSource = async (key) => {
            if (key.endsWith("meta.json")) return get(key);
            throw Object.assign(new Error("missing object"), { name: "NoSuchKey" });
        };
        expect(await publishNotices({ client: database, objectStore: store, portalHost: "my.muc.edu.cn" })).toMatchObject({ failed: 1, outcome: "partial" });
        expect(database.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO notices.processing_failures"), expect.arrayContaining([358159, "publication", "NoticePublicationDataError"]));
    });

	it("stops on storage outages without recording item failures", async () => {
		const database = fakeClient([{ rows: [candidate()] }]);
		const store = fakeStore();
		store.getSource = async () => { throw new Error("service unavailable"); };
		await expect(publishNotices({ client: database, objectStore: store, portalHost: "my.muc.edu.cn" })).rejects.toThrow("service unavailable");
		expect(database.query).toHaveBeenCalledTimes(1);
	});

	it("rolls back the notice when asset replacement fails", async () => {
		const database = { query: vi.fn(async (sql: string) => {
			if (sql.includes("SELECT notice_id::text")) return { rows: [candidate()], rowCount: 1 };
			if (sql.includes("SELECT asset_kind")) return { rows: [{ asset_kind: "image", ordinal: 0 }], rowCount: 1 };
			if (sql.includes("DELETE FROM notices.notice_assets")) throw new Error("database unavailable");
			return { rows: [], rowCount: 1 };
		}) } as unknown as PoolClient;
		await expect(publishNotices({ client: database, objectStore: fakeStore(), portalHost: "my.muc.edu.cn" })).rejects.toThrow("database unavailable");
		expect(database.query).toHaveBeenCalledWith("ROLLBACK");
		expect(database.query).not.toHaveBeenCalledWith("COMMIT");
	});

	it("succeeds without object-store reads when no notices are pending", async () => {
		const client = fakeClient([{ rows: [] }]);
		const store = fakeStore();
		await expect(
			publishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({ assets: 0, notices: 0, failed: 0, outcome: "success" });
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
		).resolves.toEqual({ assets: 0, notices: 1, failed: 0, outcome: "success" });
		expect(queries).toContain("BEGIN");
		expect(queries).toContain("COMMIT");
		expect(queries.find((text) => text.includes("UPDATE notices.notices"))).not.toContain(
			"category",
		);
		expect(progress).toEqual([
			{ phase: "processing", processed: 0, total: 1 },
			{ phase: "writing", processed: 1, total: 1 },
			{ phase: "finalizing", processed: 1, total: 1 },
		]);
	});

	it("updates a published notice projection without changing its publication state", async () => {
		const queries: string[] = [];
		const client = {
			query: vi.fn(async (text: string) => {
				queries.push(text);
				if (text.includes("SELECT notice_id::text")) {
					return { rowCount: 1, rows: [candidate({ is_published: true })] };
				}
				if (text.includes("SELECT content_html")) {
					return {
						rowCount: 1,
						rows: [{ content_html: "<p>旧正文</p>", content_text: "旧正文", is_published: true }],
					};
				}
				if (text.includes("UPDATE notices.notices")) return { rowCount: 1, rows: [] };
				if (text.includes("SELECT asset_kind")) return { rowCount: 0, rows: [] };
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;

		await expect(
			republishNotices({
				client,
				objectStore: fakeStore(),
				portalHost: "my.muc.edu.cn",
			}),
		).resolves.toEqual({
			assets: 0,
			failed: 0,
			notices: 1,
			outcome: "success",
			skipped: 0,
			unchanged: 0,
			updated: 1,
		});

		const update = queries.find((text) => text.includes("UPDATE notices.notices"));
		expect(update).toContain("content_html=$8, content_text=$9");
		expect(update).not.toContain("SET is_published");
		expect(update).not.toContain("category");
	});

	it("clears a published notice when the source has no body", async () => {
		const client = {query: vi.fn(async (sql: string) => {
			if (sql.includes("SELECT notice_id::text")) return {rows:[candidate({is_published:true})],rowCount:1};
			if (sql.includes("SELECT content_html")) return {rows:[{is_published:true,content_html:"old",content_text:"old"}],rowCount:1};
			return {rows:[],rowCount:1};
		})} as unknown as PoolClient;
		const store = fakeStore();
		vi.spyOn(store, "getSource").mockImplementation(async (key: string) => ({
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
								notice_content_html: null,
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
		}));

		await expect(
			republishNotices({
			client,
			objectStore: store,
			portalHost: "my.muc.edu.cn",
		}),
		).resolves.toMatchObject({ assets: 0, notices: 1, skipped: 0, unchanged: 0, updated: 1, failed: 0 });
		expect(client.query).toHaveBeenCalledWith(expect.stringContaining("content_html=$8"), expect.arrayContaining([null, null]));
	});

	it("rejects republishing an unpublished notice by ID", async () => {
		const client = fakeClient([{ rows: [candidate({ is_published: false })] }]);
		await expect(
			republishNotices({
				client,
				noticeIds: [358159],
				objectStore: fakeStore(),
				portalHost: "my.muc.edu.cn",
			}),
		).rejects.toThrow("notice 358159 is not published");
	});

	it("isolates republish data errors, commits the rest, and retries without residue", async () => {
		const queries: string[] = [];
		const client = {
			query: vi.fn(async (text: string, values?: unknown[]) => {
				queries.push(text);
				if (text.includes("SELECT notice_id::text")) {
					return {
						rowCount: 2,
						rows: [candidate({ notice_id: "1", is_published: true }), candidate({ is_published: true })],
					};
				}
				if (text.includes("SELECT content_html")) {
					return {
						rowCount: 1,
						rows: [{ content_html: "<p>旧正文</p>", content_text: "旧正文", is_published: true }],
					};
				}
				if (text.includes("UPDATE notices.notices")) return { rowCount: 1, rows: [] };
				if (text.includes("SELECT asset_kind")) return { rowCount: 0, rows: [] };
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		const store = fakeStore();
		const getSource = store.getSource;
		let broken = true;
		store.getSource = async (key: string) => {
			const stored = await getSource(key);
			if (key.endsWith("/1.json")) {
				if (broken) {
					return { body: Buffer.from("broken json"), contentType: "application/json" };
				}
				const source = JSON.parse(Buffer.from(stored.body).toString("utf8")) as {
					notice_id: number;
				};
				source.notice_id = 1;
				return { body: Buffer.from(JSON.stringify(source)), contentType: "application/json" };
			}
			return stored;
		};

		await expect(
			republishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({
			assets: 0,
			failed: 1,
			notices: 1,
			outcome: "partial",
			skipped: 0,
			unchanged: 0,
			updated: 1,
		});
		expect(client.query).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO notices.processing_failures"),
			expect.arrayContaining([1, "publication", "NoticePublicationDataError"]),
		);
		expect(queries.filter((text) => text === "COMMIT")).toHaveLength(1);

		queries.length = 0;
		broken = false;
		await expect(
			republishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({
			assets: 0,
			failed: 0,
			notices: 2,
			outcome: "success",
			skipped: 0,
			unchanged: 0,
			updated: 2,
		});
		expect(client.query).toHaveBeenCalledWith(
			expect.stringContaining("DELETE FROM notices.processing_failures"),
			expect.arrayContaining([1]),
		);
		expect(queries).toContain("COMMIT");
	});

	it("stops republish on a database outage without recording item failures", async () => {
		const client = {
			query: vi.fn(async (text: string) => {
				if (text.includes("SELECT notice_id::text")) {
					return { rowCount: 1, rows: [candidate({ is_published: true })] };
				}
				if (text.includes("SELECT content_html")) throw new Error("database unavailable");
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		await expect(
			republishNotices({ client, objectStore: fakeStore(), portalHost: "my.muc.edu.cn" }),
		).rejects.toThrow("database unavailable");
		expect(client.query).toHaveBeenCalledWith("ROLLBACK");
		expect(client.query).not.toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO notices.processing_failures"),
			expect.anything(),
		);
	});

	it("counts an unchanged republish and still clears publication failures", async () => {
		const queries: string[] = [];
		const normalized = normalizePublishedNoticeContent({
			html: "<p>正文</p>",
			isExternal: false,
			portalHost: "my.muc.edu.cn",
			title: "测试通知",
		});
		const client = {
			query: vi.fn(async (text: string, values?: unknown[]) => {
				queries.push(text);
				if (text.includes("SELECT notice_id::text")) {
					return { rowCount: 1, rows: [candidate({ is_published: true })] };
				}
				if (text.includes("SELECT content_html")) {
					return {
						rowCount: 1,
						rows: [
							{
								content_html: normalized.contentHtml,
								content_text: normalized.contentText,
								is_published: true,
							},
						],
					};
				}
				if (text.includes("SELECT asset_kind")) return { rowCount: 1, rows: [] };
				return { rowCount: 1, rows: [] };
			}),
		} as unknown as PoolClient;

		await expect(
			republishNotices({ client, objectStore: fakeStore(), portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({
			assets: 0,
			failed: 0,
			notices: 1,
			outcome: "success",
			skipped: 0,
			unchanged: 1,
			updated: 0,
		});
		expect(queries.find((text) => text.includes("UPDATE notices.notices"))).toContain("source_ref IS NOT DISTINCT FROM");
		expect(client.query).toHaveBeenCalledWith(
			expect.stringContaining("DELETE FROM notices.processing_failures"),
			expect.arrayContaining([358159]),
		);
		expect(queries).toContain("COMMIT");
	});

	it("omits missing attachment objects while preserving the remaining source ordinals", async () => {
		const insertedAssets: unknown[][] = [];
		const client = {
			query: vi.fn(async (text: string, values?: unknown[]) => {
				if (text.includes("SELECT notice_id::text")) {
					return { rowCount: 1, rows: [candidate()] };
				}
				if (text.includes("UPDATE notices.notices")) {
					return { rowCount: 1, rows: [] };
				}
				if (text.includes("SELECT asset_kind")) {
					return { rowCount: 0, rows: [] };
				}
				if (text.includes("INSERT INTO notices.notice_assets")) {
					insertedAssets.push(values ?? []);
				}
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		const source = {
			attachments: [
				{
					notice_annex_id: "missing-annex",
					notice_annex_name: "缺失附件.xlsx",
					notice_annex_path: "/storage/missing.xlsx",
					suffix: "xlsx",
					type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				},
				{
					notice_annex_id: "present-annex",
					notice_annex_name: "现存附件.pdf",
					notice_annex_path: "/storage/present.pdf",
					suffix: "pdf",
					type: "application/pdf",
				},
			],
			external_url: null,
			is_external: false,
			notice_content_html: "<p>正文</p>",
			notice_id: 358159,
			notice_release_time: "2026-08-11 08:00:00",
			notice_title: "测试通知",
			notice_type: 5,
			organization_id: null,
			schema_version: "internal_portal_notice_source.v2",
		};
		const getSource = vi.fn(async (key: string) => ({
			body: Buffer.from(
				JSON.stringify(
					key.endsWith("meta.json")
						? {
								notice_types: { "5": "办公通知" },
								organizations: {},
								schema_version: "internal_portal_meta.v1",
								updated_at: "2026-08-11T00:00:00.000Z",
							}
						: source,
				),
			),
			contentType: "application/json",
		}));
		const store: PublisherObjectStore = {
			close: vi.fn(),
			createDerivedAsset: vi.fn(),
			getSource,
			getSourceIfExists: vi.fn(async (key: string) =>
				key.endsWith("/attachments/0")
					? null
					: { body: Buffer.from("present"), contentType: "application/pdf" },
			),
		};

		await expect(
			publishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({ assets: 1, notices: 1, failed: 0, outcome: "success" });

		expect(store.getSourceIfExists).toHaveBeenCalledTimes(2);
		expect(insertedAssets).toHaveLength(1);
		expect(insertedAssets[0]?.slice(0, 4)).toEqual([
			358159,
			"attachment",
			1,
			"现存附件.pdf",
		]);
	});

	it("omits snapshot images the portal reported missing and keeps display ordinals contiguous", async () => {
		const insertedAssets: unknown[][] = [];
		const projected: unknown[][] = [];
		const client = {
			query: vi.fn(async (text: string, values?: unknown[]) => {
				if (text.includes("SELECT notice_id::text")) {
					return { rowCount: 1, rows: [candidate()] };
				}
				if (text.includes("UPDATE notices.notices")) {
					projected.push(values ?? []);
					return { rowCount: 1, rows: [] };
				}
				if (text.includes("SELECT asset_kind")) {
					return { rowCount: 0, rows: [] };
				}
				if (text.includes("INSERT INTO notices.notice_assets")) {
					insertedAssets.push(values ?? []);
				}
				return { rowCount: 0, rows: [] };
			}),
		} as unknown as PoolClient;
		const present = Buffer.from("present image");
		const presentSha256 = createHash("sha256").update(present).digest("hex");
		const source = {
			attachments: [],
			external_url: null,
			is_external: false,
			notice_content_html: '<p>正文</p><p><img src="/images/missing.png"><img src="/images/present.png"></p>',
			notice_id: 358159,
			notice_release_time: "2026-08-11 08:00:00",
			notice_title: "测试通知",
			notice_type: 5,
			organization_id: null,
			resources: [
				{ byte_size: null, content_type: null, kind: "images", object_key: null, ordinal: 0, sha256: null },
				{
					byte_size: present.byteLength,
					content_type: "image/png",
					kind: "images",
					object_key: `internal_portal/resources/sha256/${presentSha256}`,
					ordinal: 1,
					sha256: presentSha256,
				},
			],
			schema_version: "internal_portal_notice_source.v2",
		};
		const getSource = vi.fn(async (key: string) =>
			key.startsWith("internal_portal/resources/")
				? { body: present, contentType: "image/png" }
				: {
						body: Buffer.from(
							JSON.stringify(
								key.endsWith("meta.json")
									? {
											notice_types: { "5": "办公通知" },
											organizations: {},
											schema_version: "internal_portal_meta.v1",
											updated_at: "2026-08-11T00:00:00.000Z",
										}
									: source,
							),
						),
						contentType: "application/json",
					},
		);
		const store: PublisherObjectStore = {
			close: vi.fn(),
			createDerivedAsset: vi.fn(),
			getSource,
			getSourceIfExists: vi.fn(),
		};

		await expect(
			publishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).resolves.toEqual({ assets: 1, notices: 1, failed: 0, outcome: "success" });

		expect(getSource).not.toHaveBeenCalledWith(expect.stringContaining("/images/0"));
		expect(insertedAssets).toHaveLength(1);
		expect(insertedAssets[0]?.slice(0, 3)).toEqual([358159, "image", 0]);
		expect(JSON.stringify(projected)).toContain("notice-asset:image:0");
		expect(JSON.stringify(projected)).not.toContain("notice-asset:image:1");
	});

	it("keeps missing image objects as publication failures", async () => {
		const client = fakeClient([{ rows: [candidate()] }]);
		const source = {
			attachments: [],
			external_url: null,
			is_external: false,
			notice_content_html: '<p><img src="/images/missing.png"></p>',
			notice_id: 358159,
			notice_release_time: "2026-08-11 08:00:00",
			notice_title: "测试通知",
			notice_type: 5,
			organization_id: null,
			schema_version: "internal_portal_notice_source.v2",
		};
		const store: PublisherObjectStore = {
			close: vi.fn(),
			createDerivedAsset: vi.fn(),
			getSource: vi.fn(async (key: string) => {
				if (key.endsWith("/images/0")) {
					throw new Error("missing image object");
				}
				return {
					body: Buffer.from(
						JSON.stringify(
							key.endsWith("meta.json")
								? {
										notice_types: { "5": "办公通知" },
										organizations: {},
										schema_version: "internal_portal_meta.v1",
										updated_at: "2026-08-11T00:00:00.000Z",
									}
								: source,
						),
					),
					contentType: "application/json",
				};
			}),
			getSourceIfExists: vi.fn(),
		};

		await expect(
			publishNotices({ client, objectStore: store, portalHost: "my.muc.edu.cn" }),
		).rejects.toThrow("missing image object");
		expect(store.getSourceIfExists).not.toHaveBeenCalled();
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

	it("publishes table content as positioned logical rows without inferred labels", () => {
		const result = normalizePublishedNoticeContent({
			html: "<table><tbody><tr><th>外国语学院</th><th>郭欣悦</th></tr><tr><td>信息工程学院</td><td>华方源</td></tr></tbody></table>",
			isExternal: false,
			portalHost: "my.muc.edu.cn",
			title: "名单公示",
		});
		expect(result.contentText).toBe("外国语学院；郭欣悦\n信息工程学院；华方源");
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
	const getSource = vi.fn(async (key: string) => ({
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
	}));
	return {
		close: vi.fn(),
		createDerivedAsset: vi.fn(),
		getSource,
		getSourceIfExists: vi.fn(async (key: string) => getSource(key)),
	};
}
