import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { backfillAttachmentLinks } from "../src/backfill.ts";
import type { PublisherObjectStore } from "../src/store.ts";

describe("attachment link backfill", () => {
	it("reports pending source-backed identifiers without writing in dry-run mode", async () => {
		const client = fakeClient([
			{ notice_id: "358159", ordinal: 0, portal_annex_id: null },
			{ notice_id: "358159", ordinal: 1, portal_annex_id: "annex-2" },
		]);
		const store = fakeStore({
			358159: source(358159, ["annex-1", "annex-2"]),
		});

		await expect(
			backfillAttachmentLinks({ client, dryRun: true, objectStore: store }),
		).resolves.toEqual({
			alreadyFilled: 1,
			attachments: 2,
			mode: "dry_run",
			notices: 1,
			pending: 1,
			updated: 0,
		});
		expect(store.getSource).toHaveBeenCalledOnce();
		expect(vi.mocked(client.query)).not.toHaveBeenCalledWith("BEGIN");
	});

	it("updates only the portal attachment identifier in one transaction", async () => {
		const queries: Array<{ params?: unknown[]; text: string }> = [];
		const query = vi.fn(async (text: string, params?: unknown[]) => {
			queries.push({ params, text });
			if (text.includes("SELECT notice_id::text")) {
				return { rowCount: 1, rows: [{ notice_id: "358159", ordinal: 0, portal_annex_id: null }] };
			}
			return { rowCount: text.includes("UPDATE notices.notice_assets") ? 1 : null, rows: [] };
		});
		const client = { query } as unknown as PoolClient;

		await expect(
			backfillAttachmentLinks({
				client,
				dryRun: false,
				objectStore: fakeStore({ 358159: source(358159, ["annex-1"]) }),
			}),
		).resolves.toMatchObject({ mode: "apply", pending: 0, updated: 1 });
		expect(queries.map((item) => item.text)).toEqual([
			expect.stringContaining("SELECT notice_id::text"),
			"BEGIN",
			expect.stringContaining("SET portal_annex_id = $3"),
			"COMMIT",
		]);
		expect(queries[2]?.params).toEqual([358159, 0, "annex-1"]);
	});

	it("fails before a transaction when the source attachment has no identifier", async () => {
		const client = fakeClient([{ notice_id: "358159", ordinal: 0, portal_annex_id: null }]);
		const store = fakeStore({ 358159: source(358159, [null]) });

		await expect(
			backfillAttachmentLinks({ client, dryRun: false, objectStore: store }),
		).rejects.toThrow("notice 358159 attachment 0: attachment ordinal 0 has no notice_annex_id");
		expect(vi.mocked(client.query)).not.toHaveBeenCalledWith("BEGIN");
	});

	it("rolls back when a selected asset disappears during apply", async () => {
		const query = vi.fn(async (text: string) => {
			if (text.includes("SELECT notice_id::text")) {
				return { rowCount: 1, rows: [{ notice_id: "358159", ordinal: 0, portal_annex_id: null }] };
			}
			return { rowCount: text.includes("UPDATE notices.notice_assets") ? 0 : null, rows: [] };
		});
		const client = { query } as unknown as PoolClient;

		await expect(
			backfillAttachmentLinks({
				client,
				dryRun: false,
				objectStore: fakeStore({ 358159: source(358159, ["annex-1"]) }),
			}),
		).rejects.toThrow("disappeared during backfill");
		expect(query).toHaveBeenLastCalledWith("ROLLBACK");
	});
});

function fakeClient(rows: unknown[]): PoolClient {
	return {
		query: vi.fn(async () => ({ rowCount: rows.length, rows })),
	} as unknown as PoolClient;
}

function fakeStore(sources: Record<number, unknown>): PublisherObjectStore {
	return {
		close: vi.fn(),
		createOrVerifyDerived: vi.fn(),
		getSource: vi.fn(async (key: string) => {
			const match = /internal_portal\/notices\/([1-9][0-9]*)\.json$/u.exec(key);
			const value = match ? sources[Number(match[1])] : undefined;
			if (!value) throw new Error(`missing source: ${key}`);
			return {
				body: Buffer.from(JSON.stringify(value)),
				contentType: "application/json",
			};
		}),
	};
}

function source(noticeId: number, annexIds: Array<string | null>) {
	return {
		attachments: annexIds.map((noticeAnnexId, ordinal) => ({
			notice_annex_id: noticeAnnexId,
			notice_annex_name: `附件 ${ordinal + 1}.pdf`,
			notice_annex_path: `/storage/${ordinal + 1}`,
			suffix: "pdf",
			type: "application/pdf",
		})),
		external_url: null,
		is_external: false,
		notice_content_html: "<p>正文</p>",
		notice_id: noticeId,
		notice_release_time: "2026-08-11 08:00:00",
		notice_title: "测试通知",
		notice_type: 5,
		organization_id: null,
		schema_version: "internal_portal_notice_source.v2",
	};
}
