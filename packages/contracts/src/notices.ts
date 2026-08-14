import { z } from "zod";

export const NOTICE_DOMAINS = [
	"academic_information",
	"teaching_affairs",
	"academic_achievement",
	"campus_news",
	"student_support",
	"student_development",
	"discipline_competition",
	"admissions",
	"international_programs",
	"employment",
	"campus_operations",
	"human_resources",
	"external_cooperation",
	"procurement",
	"governance",
	"culture_sports",
	"unclassified",
] as const;

export const NOTICE_DOMAIN_LABELS = {
	academic_information: "学术信息",
	teaching_affairs: "教学事务",
	academic_achievement: "学术成果",
	campus_news: "校园新闻",
	student_support: "学生资助",
	student_development: "学生成长事务",
	discipline_competition: "学科竞赛",
	admissions: "招生",
	international_programs: "国际项目",
	employment: "就业",
	campus_operations: "校园运行",
	human_resources: "人事",
	external_cooperation: "对外合作",
	procurement: "采购",
	governance: "治理与制度",
	culture_sports: "文体活动",
	unclassified: "未分类",
} as const satisfies Record<(typeof NOTICE_DOMAINS)[number], string>;

export const NOTICE_CONTENT_ALLOWED_TAGS = [
	"A",
	"B",
	"BLOCKQUOTE",
	"BR",
	"EM",
	"H3",
	"H4",
	"H5",
	"H6",
	"I",
	"IMG",
	"LI",
	"MARK",
	"OL",
	"P",
	"S",
	"STRONG",
	"TABLE",
	"TBODY",
	"TD",
	"TH",
	"THEAD",
	"TR",
	"U",
	"UL",
] as const;

export const NOTICE_CONTENT_ALIGNMENTS = ["center", "end", "justify"] as const;
export const NOTICE_CONTENT_MAX_CELL_SPAN = 100;
export const NOTICE_CONTENT_ALLOWED_ATTRIBUTES = {
	A: ["href", "rel"],
	BLOCKQUOTE: ["data-align"],
	H3: ["data-align"],
	H4: ["data-align"],
	H5: ["data-align"],
	H6: ["data-align"],
	IMG: ["alt", "src"],
	P: ["data-align", "data-indent"],
	STRONG: ["data-emphasis"],
	TD: ["colspan", "data-align", "rowspan"],
	TH: ["colspan", "data-align", "rowspan", "scope"],
} as const satisfies Partial<
	Record<(typeof NOTICE_CONTENT_ALLOWED_TAGS)[number], readonly string[]>
>;

export const NoticeDomainSchema = z.enum(NOTICE_DOMAINS);
export type NoticeDomain = z.infer<typeof NoticeDomainSchema>;

const PositiveDecimalIdSchema = z.string().regex(/^[1-9][0-9]*$/u);
const ByteSizeSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const NonEmptyLabelSchema = z.string().trim().min(1).max(500);
const HttpUrlSchema = z
	.string()
	.url()
	.refine((value) => {
		const protocol = new URL(value).protocol;
		return protocol === "http:" || protocol === "https:";
	}, "URL 必须使用 HTTP 或 HTTPS。");

export const NoticeIdSchema = PositiveDecimalIdSchema;

export const NoticeDomainOptionSchema = z
	.object({
		label: NonEmptyLabelSchema,
		value: NoticeDomainSchema,
	})
	.strict();

export const NoticeTypeOptionSchema = z
	.object({
		label: NonEmptyLabelSchema,
		value: z.number().int().positive(),
	})
	.strict();

export const NoticeOrganizationOptionSchema = z
	.object({
		label: NonEmptyLabelSchema,
		value: z.string().trim().min(1).max(500),
	})
	.strict();

const NoticeMetadataBaseSchema = z
	.object({
		domain: NoticeDomainSchema,
		noticeId: NoticeIdSchema,
		noticeType: z.object({ id: z.number().int().positive(), name: NonEmptyLabelSchema }).strict(),
		organization: z
			.object({ id: z.string().trim().min(1).max(500), name: NonEmptyLabelSchema })
			.strict()
			.nullable(),
		releasedAt: z.iso.datetime({ offset: true }),
		title: z.string().trim().min(1).max(4000),
	})
	.strict();

export const NoticeListItemSchema = z.discriminatedUnion("isExternal", [
	NoticeMetadataBaseSchema.extend({
		externalUrl: z.null(),
		isExternal: z.literal(false),
	}).strict(),
	NoticeMetadataBaseSchema.extend({
		externalUrl: HttpUrlSchema,
		isExternal: z.literal(true),
	}).strict(),
]);

export const NoticeListResponseSchema = z
	.object({
		filters: z
			.object({
				domains: z.array(NoticeDomainOptionSchema),
				noticeTypes: z.array(NoticeTypeOptionSchema),
				organizations: z.array(NoticeOrganizationOptionSchema),
			})
			.strict(),
		items: z.array(NoticeListItemSchema),
		pagination: z
			.object({
				page: z.number().int().positive(),
				pageSize: z.literal(30),
				totalItems: z.number().int().nonnegative(),
				totalPages: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();

export const NoticeAssetMetadataSchema = z
	.object({
		byteSize: ByteSizeSchema,
		contentType: z.string().trim().min(1).max(500),
		name: z.string().trim().min(1).max(4000).nullable(),
		ordinal: z.number().int().nonnegative(),
	})
	.strict();

export const NoticeAttachmentMetadataSchema = NoticeAssetMetadataSchema.extend({
	downloadUrl: HttpUrlSchema,
}).strict();

export const NoticeImageMetadataSchema = NoticeAssetMetadataSchema.extend({
	url: z.string().regex(/^\/api\/notices\/[1-9][0-9]*\/images\/(0|[1-9][0-9]*)$/u),
}).strict();

export const NoticeDetailResponseSchema = NoticeMetadataBaseSchema.extend({
	attachments: z.array(NoticeAttachmentMetadataSchema),
	contentHtml: z.string().nullable(),
	externalUrl: z.null(),
	images: z.array(NoticeImageMetadataSchema),
	isExternal: z.literal(false),
}).strict();

const OptionalQueryTextSchema = z.string().trim().min(1);
const PageQuerySchema = z
	.string()
	.regex(/^[1-9][0-9]{0,8}$/u)
	.transform(Number);
const NoticeTypeQuerySchema = z
	.string()
	.regex(/^[1-9][0-9]*$/u)
	.transform(Number)
	.pipe(z.number().int().positive().safe());

export const NoticeListRequestQuerySchema = z
	.object({
		domain: NoticeDomainSchema.optional(),
		from: z.iso.date().optional(),
		is_external: z
			.enum(["true", "false"])
			.transform((value) => value === "true")
			.optional(),
		notice_type: NoticeTypeQuerySchema.optional(),
		organization_id: OptionalQueryTextSchema.max(500).optional(),
		page: PageQuerySchema.optional().default(1),
		q: OptionalQueryTextSchema.max(100).optional(),
		to: z.iso.date().optional(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.from && value.to && value.from > value.to) {
			context.addIssue({
				code: "custom",
				message: "起始日期不能晚于结束日期。",
				path: ["from"],
			});
		}
	});

export type NoticeAssetMetadata = z.infer<typeof NoticeAssetMetadataSchema>;
export type NoticeAttachmentMetadata = z.infer<typeof NoticeAttachmentMetadataSchema>;
export type NoticeDetailResponse = z.infer<typeof NoticeDetailResponseSchema>;
export type NoticeImageMetadata = z.infer<typeof NoticeImageMetadataSchema>;
export type NoticeListItem = z.infer<typeof NoticeListItemSchema>;
export type NoticeListRequestQuery = z.infer<typeof NoticeListRequestQuerySchema>;
export type NoticeListResponse = z.infer<typeof NoticeListResponseSchema>;
