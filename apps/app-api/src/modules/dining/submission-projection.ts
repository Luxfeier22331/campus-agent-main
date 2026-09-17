import {
	type DiningMySubmission,
	DiningMySubmissionSchema,
	type DiningSubmission,
	DiningSubmissionSchema,
} from "@campus-agent/dining/domain";
import { and, eq } from "drizzle-orm";
import { diningSubmissionReports } from "../../db/schema";
import {
	currentSubmissionPhoto,
	publishedWindowIds,
	type SubmissionExecutor,
	type SubmissionPhotoRow,
	type SubmissionRow,
	submissionAuthorCanWrite,
	submissionNotFound,
} from "./submission-store";

function photoProjection(row: SubmissionRow, photo: SubmissionPhotoRow | null, own: boolean) {
	if (!photo || photo.submissionId !== row.submissionId || !photo.current) {
		return null;
	}
	return {
		height: photo.height,
		width: photo.width,
		photoId: photo.photoId,
		url: `/api/dining/${own ? "me/" : ""}submissions/${row.submissionId}/photos/${photo.photoId}`,
	};
}

export interface OwnProjectionContext {
	editable: boolean;
	photo: SubmissionPhotoRow | null;
	windowIds: Set<string>;
}

export function toOwnSubmission(
	row: SubmissionRow,
	now: Date,
	context: OwnProjectionContext,
): DiningMySubmission {
	if (!row.windowId || row.status === "purged" || row.purgedAt) {
		throw submissionNotFound();
	}
	const windowAvailable = context.windowIds.has(row.windowId);
	const common = {
		canDelete: Boolean(context.editable),
		canEdit: Boolean(context.editable && windowAvailable),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		deletedAt: row.deletedAt?.toISOString() ?? null,
		expiresAt: row.expiresAt?.toISOString() ?? null,
		hiddenAt: row.hiddenAt?.toISOString() ?? null,
		revision: row.revision,
		submissionId: row.submissionId,
		windowId: row.windowId,
		windowAvailable,
	};
	if (row.deletedAt && row.expiresAt) {
		return DiningMySubmissionSchema.parse({
			...common,
			canDelete: false,
			canEdit: false,
			status: row.expiresAt <= now || row.status === "expired" ? "expired" : "deleted",
		});
	}
	return DiningMySubmissionSchema.parse({
		...common,
		status: row.hiddenAt ? "hidden" : "public",
		name: row.name,
		priceText: row.priceText,
		photo: photoProjection(row, context.photo, true),
	});
}

export async function projectOwnSubmission(
	db: SubmissionExecutor,
	row: SubmissionRow,
	now: Date,
): Promise<DiningMySubmission> {
	return toOwnSubmission(row, now, {
		editable: !row.accountDeletingAt && (await submissionAuthorCanWrite(db, row.authorId)),
		photo: await currentSubmissionPhoto(db, row.submissionId),
		windowIds: await publishedWindowIds(db),
	});
}

export interface PublicProjectionContext {
	hasReported: boolean;
	photo: SubmissionPhotoRow | null;
	viewerUserId: string | null;
}

export function toPublicSubmission(
	row: SubmissionRow,
	context: PublicProjectionContext,
): DiningSubmission {
	return DiningSubmissionSchema.parse({
		authorName: row.authorDisplayName,
		canReport: Boolean(
			context.viewerUserId && context.viewerUserId !== row.authorId && !context.hasReported,
		),
		createdAt: row.createdAt.toISOString(),
		hasReported: context.hasReported,
		name: row.name,
		photo: photoProjection(row, context.photo, false),
		priceText: row.priceText,
		source: "user_submission",
		submissionId: row.submissionId,
		updatedAt: row.updatedAt.toISOString(),
		windowId: row.windowId,
	});
}

export async function projectPublicSubmission(
	db: SubmissionExecutor,
	row: SubmissionRow,
	viewerUserId: string | null,
): Promise<DiningSubmission> {
	const [report] = viewerUserId
		? await db
				.select({ id: diningSubmissionReports.reportId })
				.from(diningSubmissionReports)
				.where(
					and(
						eq(diningSubmissionReports.submissionId, row.submissionId),
						eq(diningSubmissionReports.reporterUserId, viewerUserId),
					),
				)
				.limit(1)
		: [];
	return toPublicSubmission(row, {
		hasReported: Boolean(report),
		photo: await currentSubmissionPhoto(db, row.submissionId),
		viewerUserId,
	});
}
