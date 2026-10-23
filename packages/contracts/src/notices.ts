import { z } from "zod";

export const NOTICE_CATEGORIES = [
	"research_affairs",
	"lectures_forums",
	"teaching_affairs",
	"student_affairs",
	"competitions",
	"admissions",
	"international_programs",
	"employment",
	"campus_operations",
	"human_resources",
	"governance",
	"procurement",
	"campus_activities",
	"campus_news",
	"unclassified",
] as const;

export const NOTICE_CATEGORY_LABELS = {
	research_affairs: "科研项目与服务",
	lectures_forums: "讲座与学术交流",
	teaching_affairs: "教学与学籍",
	student_affairs: "学生事务",
	competitions: "竞赛与评选",
	admissions: "招生与升学",
	international_programs: "国际项目",
	employment: "就业与岗位",
	campus_operations: "校园服务与运行",
	human_resources: "人事事务",
	governance: "校务治理",
	procurement: "采购招标",
	campus_activities: "校园活动",
	campus_news: "校园动态",
	unclassified: "未分类",
} as const satisfies Record<(typeof NOTICE_CATEGORIES)[number], string>;

export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

export const NOTICE_FILTER_CATEGORIES = [
	"research_affairs",
	"lectures_forums",
	"teaching_affairs",
	"student_affairs",
	"competitions",
	"admissions",
	"international_programs",
	"employment",
	"campus_operations",
	"human_resources",
	"governance",
	"procurement",
	"campus_activities",
] as const satisfies readonly NoticeCategory[];
export type NoticeFilterCategory = (typeof NOTICE_FILTER_CATEGORIES)[number];

/**
 * 内部通知的新标签：category 表示业务主题，intent 表示读者要做什么，两者正交。外部通知不分类。
 * 第二次发布把读者侧切到这组值后删除上面的旧类别。
 */
export const NOTICE_LABEL_CATEGORIES = [
	"procurement",
	"competition",
	"lecture_forum",
	"training",
	"application",
	"recruitment",
	"international",
	"selection_result",
	"examination",
	"service_info",
	"teaching_schedule",
	"activity",
	"news",
	"affairs",
	"governance",
] as const;
export type NoticeLabelCategory = (typeof NOTICE_LABEL_CATEGORIES)[number];

export const NOTICE_LABEL_CATEGORY_LABELS = {
	procurement: "采购招标",
	competition: "竞赛",
	lecture_forum: "讲座论坛",
	training: "培训",
	application: "申报遴选",
	recruitment: "招聘就业",
	international: "国际交流",
	selection_result: "结果公示",
	examination: "考试",
	service_info: "服务信息",
	teaching_schedule: "教学安排",
	activity: "校园活动",
	news: "校园新闻",
	affairs: "事务办理",
	governance: "组织工作",
} as const satisfies Record<NoticeLabelCategory, string>;

/**
 * 读者动作：这条通知要读者做什么，只看标题判定，与 category 正交。时效不在标签里，读者侧按发布时间
 * 组合入口（近期待办、近期活动、近期安排）。
 */
export const NOTICE_LABEL_INTENTS = ["action", "event", "notice", "result", "reference"] as const;
export type NoticeLabelIntent = (typeof NOTICE_LABEL_INTENTS)[number];

export const NOTICE_LABEL_INTENT_LABELS = {
	action: "需办理",
	event: "可参加",
	notice: "需知悉",
	result: "看结果",
	reference: "长期参考",
} as const satisfies Record<NoticeLabelIntent, string>;

export interface NoticeLabel {
	category: NoticeLabelCategory;
	intent: NoticeLabelIntent;
}

export const NOTICE_STREAMS = ["notices", "campus_news"] as const;

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

export const NoticeCategorySchema = z.enum(NOTICE_CATEGORIES);
export const NoticeFilterCategorySchema = z.enum(NOTICE_FILTER_CATEGORIES);
export const NoticeStreamSchema = z.enum(NOTICE_STREAMS);
export const NoticeLabelCategorySchema = z.enum(NOTICE_LABEL_CATEGORIES);
export const NoticeLabelIntentSchema = z.enum(NOTICE_LABEL_INTENTS);
export type NoticeStream = z.infer<typeof NoticeStreamSchema>;

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

export const NoticeCategoryOptionSchema = z
	.object({
		label: NonEmptyLabelSchema,
		value: NoticeFilterCategorySchema,
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
		category: NoticeCategorySchema,
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
				categories: z.array(NoticeCategoryOptionSchema),
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
		category: NoticeFilterCategorySchema.optional(),
		from: z.iso.date().optional(),
		is_external: z
			.enum(["true", "false"])
			.transform((value) => value === "true")
			.optional(),
		notice_type: NoticeTypeQuerySchema.optional(),
		organization_id: OptionalQueryTextSchema.max(500).optional(),
		page: PageQuerySchema.optional().default(1),
		q: OptionalQueryTextSchema.max(100).optional(),
		stream: NoticeStreamSchema.optional().default("notices"),
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
		if (value.stream === "campus_news" && value.category) {
			context.addIssue({
				code: "custom",
				message: "校园动态视图不接受分类筛选。",
				path: ["category"],
			});
		}
	});

export type NoticeAttachmentMetadata = z.infer<typeof NoticeAttachmentMetadataSchema>;
export type NoticeDetailResponse = z.infer<typeof NoticeDetailResponseSchema>;
export type NoticeListItem = z.infer<typeof NoticeListItemSchema>;
export type NoticeListRequestQuery = z.infer<typeof NoticeListRequestQuerySchema>;
export type NoticeListResponse = z.infer<typeof NoticeListResponseSchema>;
