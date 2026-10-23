import { describe, expect, it } from "vitest";
import {
	NOTICE_CATEGORIES,
	NOTICE_CATEGORY_LABELS,
	NOTICE_CONTENT_ALIGNMENTS,
	NOTICE_CONTENT_ALLOWED_ATTRIBUTES,
	NOTICE_CONTENT_ALLOWED_TAGS,
	NoticeDetailResponseSchema,
	NoticeListRequestQuerySchema,
	NoticeListResponseSchema,
} from "../src/notices";

const metadata = {
	category: "campus_operations",
	noticeId: "358159",
	noticeType: { id: 5, name: "办公通知" },
	organization: { id: "100", name: "海淀校区" },
	releasedAt: "2026-08-11T00:00:00.000Z",
	title: "关于暂停开放的通知",
} as const;

describe("notice contracts", () => {
	it("keeps every category paired with one Chinese label", () => {
		expect(Object.keys(NOTICE_CATEGORY_LABELS)).toEqual([...NOTICE_CATEGORIES]);
		expect(NOTICE_CATEGORY_LABELS.unclassified).toBe("未分类");
	});

	it("defines the bounded normalized notice HTML contract", () => {
		expect(NOTICE_CONTENT_ALLOWED_TAGS).toContain("MARK");
		expect(NOTICE_CONTENT_ALLOWED_TAGS).not.toContain("H1");
		expect(NOTICE_CONTENT_ALLOWED_TAGS).not.toContain("H2");
		expect(NOTICE_CONTENT_ALIGNMENTS).toEqual(["center", "end", "justify"]);
		expect(NOTICE_CONTENT_ALLOWED_ATTRIBUTES).toMatchObject({
			IMG: ["alt", "src"],
			P: ["data-align", "data-indent"],
			TH: ["colspan", "data-align", "rowspan", "scope"],
		});
	});

	it("parses list filters and rejects reversed dates", () => {
		expect(
			NoticeListRequestQuerySchema.parse({
				category: "campus_operations",
				is_external: "false",
				notice_type: "5",
				page: "2",
				q: "暂停开放",
			}),
		).toMatchObject({
			category: "campus_operations",
			is_external: false,
			notice_type: 5,
			page: 2,
			stream: "notices",
		});
		expect(
			NoticeListRequestQuerySchema.safeParse({ from: "2026-08-12", to: "2026-08-11" }).success,
		).toBe(false);
		expect(
			NoticeListRequestQuerySchema.safeParse({
				category: "campus_operations",
				stream: "campus_news",
			}).success,
		).toBe(false);
	});

	it("parses internal and external list items without bigint JSON values", () => {
		const response = {
			filters: {
				categories: [{ label: "校园服务与运行", value: "campus_operations" }],
				noticeTypes: [{ label: "办公通知", value: 5 }],
				organizations: [{ label: "海淀校区", value: "100" }],
			},
			items: [
				{ ...metadata, externalUrl: null, isExternal: false },
				{
					...metadata,
					externalUrl: "https://mp.weixin.qq.com/s/example",
					isExternal: true,
					noticeId: "358160",
				},
			],
			pagination: { page: 1, pageSize: 30, totalItems: 2, totalPages: 1 },
		};
		expect(NoticeListResponseSchema.safeParse(response).success).toBe(true);
		expect(
			NoticeListResponseSchema.safeParse({
				...response,
				items: [{ ...metadata, externalUrl: null, isExternal: true }],
			}).success,
		).toBe(false);
	});

	it("parses details with private image URLs and attachment metadata", () => {
		expect(
			NoticeDetailResponseSchema.safeParse({
				...metadata,
				attachments: [
					{
						byteSize: "1234",
						contentType: "application/pdf",
						downloadUrl:
							"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=annex-1&notice_id=358159",
						name: "附件.pdf",
						ordinal: 0,
					},
				],
				contentHtml: '<p>正文<img src="notice-asset:image:0" alt=""></p>',
				externalUrl: null,
				images: [
					{
						byteSize: "256",
						contentType: "image/png",
						name: null,
						ordinal: 0,
						url: "/api/notices/358159/images/0",
					},
				],
				isExternal: false,
			}).success,
		).toBe(true);
		expect(
			NoticeDetailResponseSchema.safeParse({
				...metadata,
				attachments: [
					{
						byteSize: "1234",
						contentType: "application/pdf",
						name: "附件.pdf",
						ordinal: 0,
					},
				],
				contentHtml: null,
				externalUrl: null,
				images: [],
				isExternal: false,
			}).success,
		).toBe(false);
	});
});
