// @vitest-environment node

import type { InternalPortalNoticeSource } from "ingestion-contracts";
import { describe, expect, it, vi } from "vitest";
import portal from "../../../configs/sources/internal-portal.json" with { type: "json" };
import {
	NoticePreviewError,
	prepareNoticePreview,
	readNoticeSource,
} from "../src/server/notice-preview";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import type { NoticeSummary } from "../src/shared/ops-contract";
import { createTestOpsApp } from "./helpers/ops-app";

const host = new URL(portal.portal_base_url).hostname;
const source: InternalPortalNoticeSource = {
	schema_version: "internal_portal_notice_source.v2",
	notice_id: 900001,
	notice_type: 5,
	organization_id: null,
	notice_title: "预览测试",
	notice_release_time: "2026-09-12 08:00:00",
	is_external: false,
	external_url: null,
	notice_content_html: `<p>正文内容</p><img src="https://${host}/spacer.gif"><img src="https://${host}/photo.jpg"><table><tr><td>时间</td><td>08:00</td></tr></table><script>alert(1)</script>`,
	attachments: [
		{
			notice_annex_id: "1",
			notice_annex_name: "安排.pdf",
			notice_annex_path: "/1.pdf",
			suffix: "pdf",
			type: null,
		},
	],
};
const notice: NoticeSummary = {
	noticeId: 900001,
	title: "预览测试",
	category: null,
	state: "needs_classification",
	noticeType: { id: 5, name: "办公通知" },
	organization: null,
	releasedAt: "2026-09-12T00:00:00Z",
	isExternal: false,
	externalUrl: null,
};
function setup(value: InternalPortalNoticeSource = source, published = false) {
	const body = (text: string) => {
		const stream = new Response(text).body;
		if (!stream) {
			throw new Error("Missing test body");
		}
		return stream;
	};
	const get = vi.fn(async (key: string) => ({
		body: body(
			key.endsWith(".json")
				? JSON.stringify(value)
				: key.endsWith("attachments/0")
					? "%PDF-test"
					: "image-bytes",
		),
		contentType: key.endsWith("attachments/0") ? "application/pdf" : "image/jpeg",
	}));
	const updateCategory = vi.fn();
	const create = vi.fn();
	const app = createTestOpsApp({
		admission: createAllowAllOpsAdmission(),
		noticeStore: {
			get: vi.fn(
				async (): Promise<NoticeSummary> =>
					published ? { ...notice, category: "campus_operations", state: "published" } : notice,
			),
			list: vi.fn(),
			updateCategory,
		},
		noticeJobService: { create, get: vi.fn(), list: vi.fn() },
		noticePreviewStore: { get },
	});
	return { app, get, updateCategory, create };
}

describe("notice preview", () => {
	it.each([false, true])("reads source without publishing (published=%s)", async (published) => {
		const { app, get, updateCategory, create } = setup(source, published);
		const r = await app.request("/api/ops/notices/900001/preview");
		expect(r.status).toBe(200);
		const data = await r.json();
		expect(data.contentHtml).toContain("正文内容");
		expect(data.contentHtml).toContain("<table>");
		expect(data.contentHtml).not.toContain("<script");
		expect(data.images).toEqual([{ ordinal: 0, url: "/api/ops/notices/900001/images/0" }]);
		expect(data.attachments[0].url).toBe("/api/ops/notices/900001/attachments/0");
		expect(get).toHaveBeenCalledTimes(1);
		expect(updateCategory).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
	it("maps display ordinal to source ordinal and streams a PDF with its filename", async () => {
		const { app, get } = setup();
		const image = await app.request("/api/ops/notices/900001/images/0");
		expect(await image.text()).toBe("image-bytes");
		expect(get).toHaveBeenLastCalledWith("internal_portal/notices/900001/images/1");
		expect(image.headers.get("content-type")).toBe("image/jpeg");
		const pdf = await app.request("/api/ops/notices/900001/attachments/0");
		expect(await pdf.text()).toBe("%PDF-test");
		expect(pdf.headers.get("content-disposition")).toContain("inline;");
		expect(pdf.headers.get("content-disposition")).toContain(encodeURIComponent("安排.pdf"));
		expect(pdf.headers.get("cache-control")).toBe("private, no-store");
		expect((await app.request("/api/ops/notices/900001/images/1")).status).toBe(404);
	});
	it("omits snapshot images the portal reported missing", () => {
		const { preview, images } = prepareNoticePreview({
			...source,
			notice_content_html: `<p>正文内容</p><img src="https://${host}/gone.jpg"><img src="https://${host}/photo.jpg">`,
			resources: [
				{
					kind: "images",
					ordinal: 0,
					object_key: null,
					content_type: null,
					byte_size: null,
					sha256: null,
				},
				{
					kind: "images",
					ordinal: 1,
					object_key: "internal_portal/resources/sha256/photo",
					content_type: "image/jpeg",
					byte_size: 11,
					sha256: "a".repeat(64),
				},
			],
		});
		expect(preview.contentHtml).not.toContain("notice-asset:image:1");
		expect(preview.images).toEqual([{ ordinal: 0, url: "/api/ops/notices/900001/images/0" }]);
		expect(images.map(({ sourceOrdinal }) => sourceOrdinal)).toEqual([1]);
	});
	it("keeps external notices as links and empty-body attachments available", () => {
		const external = prepareNoticePreview({
			...source,
			is_external: true,
			external_url: "https://example.com/article",
		}).preview;
		expect(external).toMatchObject({
			contentHtml: null,
			images: [],
			attachments: [],
			externalUrl: "https://example.com/article",
		});
		expect(
			prepareNoticePreview({ ...source, notice_content_html: null }).preview.attachments,
		).toHaveLength(1);
	});
	it("rejects unauthorized access before reading any source", async () => {
		const get = vi.fn();
		const app = createTestOpsApp({
			admission: {
				admit: async () => ({ operator: null, response: new Response(null, { status: 401 }) }),
			},
			noticePreviewStore: { get },
		});
		for (const path of ["preview", "images/0", "attachments/0"]) {
			expect((await app.request(`/api/ops/notices/900001/${path}`)).status).toBe(401);
		}
		expect(get).not.toHaveBeenCalled();
	});
	it("rejects missing notices and invalid ordinals without reading arbitrary objects", async () => {
		const { app, get } = setup();
		expect((await app.request("/api/ops/notices/900001/images/-1")).status).toBe(400);
		expect((await app.request("/api/ops/notices/no/preview")).status).toBe(400);
		expect(get).not.toHaveBeenCalled();
		const missing = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticeStore: { get: vi.fn(async () => null), list: vi.fn(), updateCategory: vi.fn() },
			noticePreviewStore: { get },
		});
		expect((await missing.request("/api/ops/notices/900001/preview")).status).toBe(404);
		expect(get).not.toHaveBeenCalled();
	});
	it.each([404, 502, 503] as const)("returns source failures with status %s", async (status) => {
		const { app, get } = setup();
		get.mockRejectedValue(new NoticePreviewError("OPS_NOTICE_SOURCE_TEST", "来源读取失败", status));
		const result = await app.request("/api/ops/notices/900001/preview");
		expect(result.status).toBe(status);
		expect(await result.json()).toMatchObject({ error: { message: "来源读取失败" } });
	});
	it("does not serve HTML attachments as active same-origin pages", async () => {
		const { app, get } = setup();
		get.mockImplementation(async (key) => ({
			body: (() => {
				const stream = new Response(
					key.endsWith(".json") ? JSON.stringify(source) : "<script>alert(1)</script>",
				).body;
				if (!stream) {
					throw new Error("Missing test body");
				}
				return stream;
			})(),
			contentType: "text/html",
		}));
		const r = await app.request("/api/ops/notices/900001/attachments/0");
		expect(r.headers.get("content-type")).toBe("application/octet-stream");
		expect(r.headers.get("content-disposition")).toContain("attachment;");
		await r.text();
	});
	it("rejects malformed and mismatched source records", async () => {
		for (const data of ["not-json", JSON.stringify({ ...source, notice_id: 900002 })]) {
			await expect(
				readNoticeSource(
					{
						get: async () => {
							const body = new Response(data).body;
							if (!body) {
								throw new Error("Missing test body");
							}
							return { body, contentType: "application/json" };
						},
					},
					900001,
				),
			).rejects.toMatchObject({ code: "OPS_NOTICE_SOURCE_INVALID" });
		}
	});
});
