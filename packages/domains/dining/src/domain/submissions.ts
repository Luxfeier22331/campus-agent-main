import { z } from "zod";
import {
	DiningMenuItemSchema,
	DiningOpsReviewRecordSchema,
	DiningReportReasonSchema,
	DiningReportResolutionSchema,
	DiningReviewCreateSchema,
	DiningReviewReportCreateSchema,
	DiningReviewSchema,
} from "./content.ts";

const isoDate = z.string().datetime({ offset: true });
const identifier = z.string().trim().min(1).max(200);
const cursor = z.string().min(1).nullable();
const submissionContent = DiningMenuItemSchema.pick({ name: true, priceText: true });

export const DINING_SUBMISSION_PHOTO_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const DINING_SUBMISSION_PHOTO_MAX_INPUT_DIMENSION = 4096;
export const DINING_SUBMISSION_PHOTO_MAX_OUTPUT_DIMENSION = 1600;

export const DiningSubmissionRevisionSchema = z.number().int().positive();

export const DiningSubmissionCreateSchema = submissionContent
	.extend({ photoAction: z.enum(["none", "replace"]) })
	.strict();

export type DiningSubmissionCreate = z.infer<typeof DiningSubmissionCreateSchema>;

export const DiningSubmissionUpdateSchema = submissionContent
	.extend({ photoAction: z.enum(["keep", "remove", "replace"]) })
	.strict();

export type DiningSubmissionUpdate = z.infer<typeof DiningSubmissionUpdateSchema>;

const photoFields = {
	height: z.number().int().positive().max(DINING_SUBMISSION_PHOTO_MAX_OUTPUT_DIMENSION),
	photoId: identifier,
	width: z.number().int().positive().max(DINING_SUBMISSION_PHOTO_MAX_OUTPUT_DIMENSION),
};

export const DiningSubmissionPhotoSchema = z
	.object({
		...photoFields,
		url: z
			.string()
			.max(500)
			.regex(/^\/api\/dining\/submissions\/[A-Za-z0-9_-]{1,200}\/photos\/[A-Za-z0-9_-]{1,200}$/),
	})
	.strict();

export type DiningSubmissionPhoto = z.infer<typeof DiningSubmissionPhotoSchema>;

export const DiningMySubmissionPhotoSchema = z
	.object({
		...photoFields,
		url: z
			.string()
			.max(500)
			.regex(
				/^\/api\/dining\/me\/submissions\/[A-Za-z0-9_-]{1,200}\/photos\/[A-Za-z0-9_-]{1,200}$/,
			),
	})
	.strict();

export type DiningMySubmissionPhoto = z.infer<typeof DiningMySubmissionPhotoSchema>;

export const DiningSubmissionSchema = submissionContent
	.extend({
		authorName: z.string().min(1).max(200),
		canReport: z.boolean(),
		createdAt: isoDate,
		hasReported: z.boolean(),
		photo: DiningSubmissionPhotoSchema.nullable(),
		source: z.literal("user_submission"),
		submissionId: identifier,
		updatedAt: isoDate,
		windowId: identifier,
	})
	.strict();

export type DiningSubmission = z.infer<typeof DiningSubmissionSchema>;

export const DiningSubmissionResponseSchema = z
	.object({ submission: DiningSubmissionSchema })
	.strict();

export type DiningSubmissionResponse = z.infer<typeof DiningSubmissionResponseSchema>;

export const DiningSubmissionPageSchema = z
	.object({ items: z.array(DiningSubmissionSchema), nextCursor: cursor })
	.strict();

export type DiningSubmissionPage = z.infer<typeof DiningSubmissionPageSchema>;

const mySubmissionMetadata = z
	.object({
		canDelete: z.boolean(),
		canEdit: z.boolean(),
		createdAt: isoDate,
		deletedAt: isoDate.nullable(),
		expiresAt: isoDate.nullable(),
		hiddenAt: isoDate.nullable(),
		revision: DiningSubmissionRevisionSchema,
		submissionId: identifier,
		updatedAt: isoDate,
		windowAvailable: z.boolean(),
		windowId: identifier,
	})
	.strict();

const myCurrentSubmission = mySubmissionMetadata.extend({
	...submissionContent.shape,
	deletedAt: z.null(),
	expiresAt: z.null(),
	photo: DiningMySubmissionPhotoSchema.nullable(),
});

const myDeletedSubmission = mySubmissionMetadata.extend({
	canDelete: z.literal(false),
	canEdit: z.literal(false),
	deletedAt: isoDate,
	expiresAt: isoDate,
});

export const DiningMySubmissionSchema = z.discriminatedUnion("status", [
	myCurrentSubmission.extend({ hiddenAt: z.null(), status: z.literal("public") }).strict(),
	myCurrentSubmission.extend({ hiddenAt: isoDate, status: z.literal("hidden") }).strict(),
	myDeletedSubmission.extend({ status: z.literal("deleted") }).strict(),
	myDeletedSubmission.extend({ status: z.literal("expired") }).strict(),
]);

export type DiningMySubmission = z.infer<typeof DiningMySubmissionSchema>;

export const DiningMySubmissionResponseSchema = z
	.object({ submission: DiningMySubmissionSchema })
	.strict();

export type DiningMySubmissionResponse = z.infer<typeof DiningMySubmissionResponseSchema>;

export const DiningMySubmissionPageSchema = z
	.object({ items: z.array(DiningMySubmissionSchema), nextCursor: cursor })
	.strict();

export type DiningMySubmissionPage = z.infer<typeof DiningMySubmissionPageSchema>;

export const DiningSubmissionReviewSchema = DiningReviewSchema.omit({ menuItemId: true })
	.extend({ submissionId: identifier })
	.strict();

export type DiningSubmissionReview = z.infer<typeof DiningSubmissionReviewSchema>;

export const DiningSubmissionReviewPageSchema = z
	.object({ items: z.array(DiningSubmissionReviewSchema), nextCursor: cursor })
	.strict();

export type DiningSubmissionReviewPage = z.infer<typeof DiningSubmissionReviewPageSchema>;

export const DiningSubmissionReviewCreateSchema = DiningReviewCreateSchema;
export type DiningSubmissionReviewCreate = z.infer<typeof DiningSubmissionReviewCreateSchema>;

export const DiningSubmissionReportCreateSchema = DiningReviewReportCreateSchema;
export type DiningSubmissionReportCreate = z.infer<typeof DiningSubmissionReportCreateSchema>;

export const DiningSubmissionReviewReportCreateSchema = DiningReviewReportCreateSchema;
export type DiningSubmissionReviewReportCreate = z.infer<
	typeof DiningSubmissionReviewReportCreateSchema
>;

export const DiningOpsSubmissionPhotoSchema = z
	.object({
		...photoFields,
		url: z
			.string()
			.max(500)
			.regex(
				/^\/api\/ops\/dining\/submissions\/[A-Za-z0-9_-]{1,200}\/photos\/[A-Za-z0-9_-]{1,200}$/,
			),
	})
	.strict();

export type DiningOpsSubmissionPhoto = z.infer<typeof DiningOpsSubmissionPhotoSchema>;

const opsSubmissionMetadata = mySubmissionMetadata.omit({ canEdit: true }).extend({
	accountDeletingAt: isoDate.nullable(),
	authorDisplayName: z.string().min(1).max(200).nullable(),
	authorId: identifier.nullable(),
	canRestore: z.boolean(),
	canUnhide: z.boolean(),
	contentRevision: DiningSubmissionRevisionSchema,
	deletedBy: identifier.nullable(),
	hiddenBy: identifier.nullable(),
	pendingReportCount: z.number().int().nonnegative(),
	updatedBy: identifier.nullable(),
});

const opsSubmissionContent = opsSubmissionMetadata.extend({
	...submissionContent.shape,
	photo: DiningOpsSubmissionPhotoSchema.nullable(),
});

export const DiningOpsSubmissionRecordSchema = z
	.discriminatedUnion("status", [
		opsSubmissionContent
			.extend({
				canRestore: z.literal(false),
				canUnhide: z.literal(false),
				deletedAt: z.null(),
				deletedBy: z.null(),
				expiresAt: z.null(),
				hiddenAt: z.null(),
				hiddenBy: z.null(),
				status: z.literal("public"),
			})
			.strict(),
		opsSubmissionContent
			.extend({
				canRestore: z.literal(false),
				deletedAt: z.null(),
				deletedBy: z.null(),
				expiresAt: z.null(),
				hiddenAt: isoDate,
				status: z.literal("hidden"),
			})
			.strict(),
		opsSubmissionContent
			.extend({
				canDelete: z.literal(false),
				canUnhide: z.literal(false),
				deletedAt: isoDate,
				expiresAt: isoDate,
				status: z.literal("deleted"),
			})
			.strict(),
		opsSubmissionMetadata
			.extend({
				canDelete: z.literal(false),
				canRestore: z.literal(false),
				canUnhide: z.literal(false),
				deletedAt: isoDate,
				expiresAt: isoDate,
				status: z.literal("expired"),
			})
			.strict(),
		z
			.object({
				canDelete: z.literal(false),
				canRestore: z.literal(false),
				canUnhide: z.literal(false),
				contentRevision: DiningSubmissionRevisionSchema,
				purgedAt: isoDate,
				revision: DiningSubmissionRevisionSchema,
				status: z.literal("purged"),
				submissionId: identifier,
			})
			.strict(),
	])
	.superRefine((submission, context) => {
		if (submission.contentRevision > submission.revision) {
			context.addIssue({
				code: "custom",
				message: "The content revision cannot follow the operation revision.",
				path: ["contentRevision"],
			});
		}
		if (
			submission.status !== "purged" &&
			submission.accountDeletingAt !== null &&
			(submission.canDelete || submission.canRestore || submission.canUnhide)
		) {
			context.addIssue({
				code: "custom",
				message: "Account deletion prevents ordinary moderation mutations.",
				path: ["accountDeletingAt"],
			});
		}
	});

export type DiningOpsSubmissionRecord = z.infer<typeof DiningOpsSubmissionRecordSchema>;

export const DiningOpsSubmissionResponseSchema = z
	.object({ submission: DiningOpsSubmissionRecordSchema })
	.strict();

export type DiningOpsSubmissionResponse = z.infer<typeof DiningOpsSubmissionResponseSchema>;

export const DiningOpsSubmissionPageSchema = z
	.object({ items: z.array(DiningOpsSubmissionRecordSchema), nextCursor: cursor })
	.strict();

export type DiningOpsSubmissionPage = z.infer<typeof DiningOpsSubmissionPageSchema>;

export const DiningOpsSubmissionRevisionSchema = z
	.object({ expectedRevision: DiningSubmissionRevisionSchema })
	.strict();

export type DiningOpsSubmissionRevision = z.infer<typeof DiningOpsSubmissionRevisionSchema>;

export const DiningOpsSubmissionVisibilitySchema = DiningOpsSubmissionRevisionSchema.extend({
	visible: z.boolean(),
}).strict();

export type DiningOpsSubmissionVisibility = z.infer<typeof DiningOpsSubmissionVisibilitySchema>;

export const DiningOpsSubmissionReportResolutionSchema = DiningOpsSubmissionRevisionSchema.extend(
	DiningReportResolutionSchema.shape,
).strict();

export type DiningOpsSubmissionReportResolution = z.infer<
	typeof DiningOpsSubmissionReportResolutionSchema
>;

export const DiningOpsSubmissionHistoricalPhotoSchema = z.discriminatedUnion("state", [
	DiningOpsSubmissionPhotoSchema.extend({
		expiresAt: isoDate.nullable(),
		state: z.literal("available"),
	}).strict(),
	z.object({ expiresAt: isoDate, photoId: identifier, state: z.literal("expired") }).strict(),
]);

export type DiningOpsSubmissionHistoricalPhoto = z.infer<
	typeof DiningOpsSubmissionHistoricalPhotoSchema
>;

export const DiningOpsSubmissionSnapshotSchema = z.discriminatedUnion("replayable", [
	submissionContent
		.extend({
			photo: DiningOpsSubmissionHistoricalPhotoSchema.nullable(),
			replayable: z.literal(true),
		})
		.strict(),
	z.object({ replayable: z.literal(false) }).strict(),
]);

export type DiningOpsSubmissionSnapshot = z.infer<typeof DiningOpsSubmissionSnapshotSchema>;

export const DiningOpsSubmissionEditRecordSchema = z
	.object({
		editId: identifier,
		editedAt: isoDate,
		editedBy: identifier.nullable(),
		next: DiningOpsSubmissionSnapshotSchema,
		nextRevision: DiningSubmissionRevisionSchema,
		previous: DiningOpsSubmissionSnapshotSchema,
		previousRevision: DiningSubmissionRevisionSchema,
	})
	.strict()
	.refine((edit) => edit.nextRevision > edit.previousRevision, {
		message: "The next revision must follow the previous revision.",
		path: ["nextRevision"],
	});

export type DiningOpsSubmissionEditRecord = z.infer<typeof DiningOpsSubmissionEditRecordSchema>;

export const DiningOpsSubmissionDetailSchema = z
	.object({
		edits: z.array(DiningOpsSubmissionEditRecordSchema),
		submission: DiningOpsSubmissionRecordSchema,
	})
	.strict();

export type DiningOpsSubmissionDetail = z.infer<typeof DiningOpsSubmissionDetailSchema>;

const opsContentReview = DiningOpsReviewRecordSchema.omit({
	menuItemId: true,
	menuItemName: true,
}).extend({
	authorDisplayName: DiningOpsReviewRecordSchema.shape.authorDisplayName.nullable(),
	authorId: identifier.nullable(),
	body: DiningReviewSchema.shape.body.nullable(),
	contentRevision: DiningSubmissionRevisionSchema,
	updatedBy: identifier.nullable(),
});

export const DiningOpsContentReviewRecordSchema = z.discriminatedUnion("targetKind", [
	opsContentReview
		.extend({
			menuItemId: identifier,
			menuItemName: DiningMenuItemSchema.shape.name,
			targetKind: z.literal("menu_item"),
		})
		.strict(),
	opsContentReview
		.extend({
			submissionId: identifier,
			submissionName: DiningMenuItemSchema.shape.name.nullable(),
			targetKind: z.literal("submission"),
			windowId: identifier.nullable(),
		})
		.strict(),
]);

export type DiningOpsContentReviewRecord = z.infer<typeof DiningOpsContentReviewRecordSchema>;

export const DiningOpsContentReviewPageSchema = z
	.object({ items: z.array(DiningOpsContentReviewRecordSchema), nextCursor: cursor })
	.strict();

export type DiningOpsContentReviewPage = z.infer<typeof DiningOpsContentReviewPageSchema>;

export const DiningOpsContentReviewResponseSchema = z
	.object({ review: DiningOpsContentReviewRecordSchema })
	.strict();

export const DiningOpsContentReviewEditRecordSchema = z.discriminatedUnion("replayable", [
	z
		.object({
			editId: identifier,
			editedAt: isoDate,
			editedBy: identifier.nullable(),
			expiresAt: isoDate.nullable(),
			nextRevision: DiningSubmissionRevisionSchema,
			previousRevision: DiningSubmissionRevisionSchema,
			nextBody: DiningReviewSchema.shape.body,
			previousBody: DiningReviewSchema.shape.body,
			replayable: z.literal(true),
		})
		.strict(),
	z
		.object({
			editId: identifier,
			editedAt: isoDate,
			editedBy: identifier.nullable(),
			expiresAt: isoDate.nullable(),
			nextRevision: DiningSubmissionRevisionSchema.nullable(),
			previousRevision: DiningSubmissionRevisionSchema.nullable(),
			replayable: z.literal(false),
		})
		.strict(),
]);

export type DiningOpsContentReviewEditRecord = z.infer<
	typeof DiningOpsContentReviewEditRecordSchema
>;

export const DiningOpsContentReviewDetailSchema = z
	.object({
		edits: z.array(DiningOpsContentReviewEditRecordSchema),
		review: DiningOpsContentReviewRecordSchema,
	})
	.strict();

export type DiningOpsContentReviewDetail = z.infer<typeof DiningOpsContentReviewDetailSchema>;

export const DiningOpsReviewSnapshotSchema = z.discriminatedUnion("replayable", [
	DiningReviewSchema.pick({ body: true })
		.extend({ replayable: z.literal(true) })
		.strict(),
	z.object({ replayable: z.literal(false) }).strict(),
]);

export type DiningOpsReviewSnapshot = z.infer<typeof DiningOpsReviewSnapshotSchema>;

export const DiningOpsContentReportTargetSchema = z
	.discriminatedUnion("kind", [
		z
			.object({
				current: DiningOpsSubmissionRecordSchema,
				kind: z.literal("submission"),
				reported: DiningOpsSubmissionSnapshotSchema,
				targetRevision: DiningSubmissionRevisionSchema,
			})
			.strict(),
		z
			.object({
				current: DiningOpsContentReviewRecordSchema,
				kind: z.literal("review"),
				reported: DiningOpsReviewSnapshotSchema,
				targetRevision: DiningSubmissionRevisionSchema.nullable(),
			})
			.strict(),
	])
	.superRefine((target, context) => {
		if (target.targetRevision === null && target.reported.replayable) {
			context.addIssue({
				code: "custom",
				message: "A replayable report requires the reported revision.",
				path: ["targetRevision"],
			});
		}
		if (target.targetRevision !== null && target.targetRevision > target.current.contentRevision) {
			context.addIssue({
				code: "custom",
				message: "The reported revision cannot follow the current revision.",
				path: ["targetRevision"],
			});
		}
	});

export type DiningOpsContentReportTarget = z.infer<typeof DiningOpsContentReportTargetSchema>;

export const DiningOpsContentReportRecordSchema = z
	.object({
		createdAt: isoDate,
		details: z.string().max(300).nullable(),
		reason: DiningReportReasonSchema,
		reportId: identifier,
		reporterUserId: identifier.nullable(),
		resolution: DiningReportResolutionSchema.shape.resolution.nullable(),
		resolvedAt: isoDate.nullable(),
		resolvedBy: identifier.nullable(),
		target: DiningOpsContentReportTargetSchema,
	})
	.strict();

export type DiningOpsContentReportRecord = z.infer<typeof DiningOpsContentReportRecordSchema>;

export const DiningOpsContentReportPageSchema = z
	.object({ items: z.array(DiningOpsContentReportRecordSchema), nextCursor: cursor })
	.strict();

export type DiningOpsContentReportPage = z.infer<typeof DiningOpsContentReportPageSchema>;
