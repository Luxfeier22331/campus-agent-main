import { z } from "zod";

const isoDate = z.string().datetime({ offset: true });
const identifier = z.string().trim().min(1).max(200);
const reviewBody = z.string().trim().min(1).max(500);

export const DiningReportReasonSchema = z.enum(["spam", "inappropriate", "privacy", "other"]);

export type DiningReportReason = z.infer<typeof DiningReportReasonSchema>;

export const DiningMenuItemSchema = z
	.object({
		menuItemId: identifier,
		name: z.string().trim().min(1).max(80),
		priceText: z.string().trim().min(1).max(40).nullable(),
		sortOrder: z.number().int().nonnegative(),
	})
	.strict();

export type DiningMenuItem = z.infer<typeof DiningMenuItemSchema>;

export const DiningWindowMenuResponseSchema = z
	.object({
		items: z.array(DiningMenuItemSchema),
		windowId: identifier,
	})
	.strict();

export type DiningWindowMenuResponse = z.infer<typeof DiningWindowMenuResponseSchema>;

export const DiningReviewSchema = z
	.object({
		anonymous: z.boolean(),
		authorName: z.string().min(1).max(200).nullable(),
		body: reviewBody,
		canDelete: z.boolean(),
		canReport: z.boolean(),
		createdAt: isoDate,
		edited: z.boolean(),
		hasReported: z.boolean(),
		menuItemId: identifier,
		reviewId: identifier,
	})
	.strict();

export type DiningReview = z.infer<typeof DiningReviewSchema>;

export const DiningReviewPageSchema = z
	.object({
		items: z.array(DiningReviewSchema),
		nextCursor: z.string().min(1).nullable(),
	})
	.strict();

export type DiningReviewPage = z.infer<typeof DiningReviewPageSchema>;

export const DiningReviewCreateSchema = z
	.object({
		anonymous: z.boolean(),
		body: reviewBody,
	})
	.strict();

export const DiningReviewReportCreateSchema = z
	.object({
		details: z.string().trim().max(300).nullable().optional(),
		reason: DiningReportReasonSchema,
	})
	.strict();

export const DiningMenuItemRecordSchema = DiningMenuItemSchema.extend({
	archivedAt: isoDate.nullable(),
	createdAt: isoDate,
	createdBy: identifier,
	updatedAt: isoDate,
	updatedBy: identifier,
	windowId: identifier,
}).strict();

export type DiningMenuItemRecord = z.infer<typeof DiningMenuItemRecordSchema>;

export const DiningMenuItemCreateSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		priceText: z.string().trim().min(1).max(40).nullable(),
		windowId: identifier,
	})
	.strict();

export const DiningMenuItemUpdateSchema = DiningMenuItemCreateSchema.partial()
	.refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段。")
	.refine((value) => value.windowId === undefined, "请使用菜品迁移接口修改窗口。")
	.transform(({ name, priceText }) => ({ name, priceText }));

export const DiningMenuItemMoveSchema = z.object({ windowId: identifier }).strict();

export const DiningMenuOrderSchema = z
	.object({ menuItemIds: z.array(identifier).min(1).max(500) })
	.strict();

export const DiningOpsReviewCreateSchema = DiningReviewCreateSchema;

export const DiningOpsReviewUpdateSchema = z.object({ body: reviewBody }).strict();

export const DiningOpsReviewVisibilitySchema = z.object({ visible: z.boolean() }).strict();

export const DiningReportResolutionSchema = z
	.object({ resolution: z.enum(["keep", "hide"]) })
	.strict();

export const DiningMenuItemListResponseSchema = z
	.object({ items: z.array(DiningMenuItemRecordSchema) })
	.strict();

export const DiningMenuItemResponseSchema = z.object({ item: DiningMenuItemRecordSchema }).strict();

export const DiningReviewEditRecordSchema = z
	.object({
		editId: identifier,
		editedAt: isoDate,
		editedBy: identifier,
		nextBody: reviewBody,
		previousBody: reviewBody,
	})
	.strict();

export const DiningOpsReviewRecordSchema = z
	.object({
		anonymous: z.boolean(),
		authorDisplayName: z.string().min(1).max(200),
		authorId: identifier,
		authorKind: z.enum(["member", "operator"]),
		body: reviewBody,
		createdAt: isoDate,
		deletedAt: isoDate.nullable(),
		editCount: z.number().int().nonnegative(),
		editedAt: isoDate.nullable(),
		hiddenAt: isoDate.nullable(),
		hiddenBy: identifier.nullable(),
		menuItemId: identifier,
		menuItemName: z.string().min(1).max(80),
		reviewId: identifier,
		updatedAt: isoDate,
		updatedBy: identifier,
		windowId: identifier,
	})
	.strict();

export const DiningOpsReviewPageSchema = z
	.object({
		items: z.array(DiningOpsReviewRecordSchema),
		nextCursor: z.string().min(1).nullable(),
	})
	.strict();

export const DiningOpsReviewDetailSchema = z
	.object({
		edits: z.array(DiningReviewEditRecordSchema),
		review: DiningOpsReviewRecordSchema,
	})
	.strict();

export const DiningOpsReportRecordSchema = z
	.object({
		createdAt: isoDate,
		details: z.string().max(300).nullable(),
		reason: DiningReportReasonSchema,
		reportId: identifier,
		reporterUserId: identifier,
		resolution: z.enum(["keep", "hide"]).nullable(),
		resolvedAt: isoDate.nullable(),
		resolvedBy: identifier.nullable(),
		review: DiningOpsReviewRecordSchema,
	})
	.strict();

export const DiningOpsReportPageSchema = z
	.object({
		items: z.array(DiningOpsReportRecordSchema),
		nextCursor: z.string().min(1).nullable(),
	})
	.strict();
