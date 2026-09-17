import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { diningSubmissionPhotos, diningSubmissions } from "../../db/schema";
import type { SubmissionTransaction } from "./submission-store";

export interface DiningAccountDeletion {
	ownerUserId: string;
	requestId: string;
}

// The caller already holds the auth user lock. Writers take user then submission
// locks too, so no new content can bind after acceptance commits.
export async function acceptDiningAccountDeletion(
	tx: SubmissionTransaction,
	input: DiningAccountDeletion & { requestedAt: Date },
) {
	const rows = await tx
		.select({ id: diningSubmissions.submissionId })
		.from(diningSubmissions)
		.where(eq(diningSubmissions.authorId, input.ownerUserId))
		.orderBy(diningSubmissions.submissionId)
		.for("update");
	for (const row of rows) {
		await tx
			.update(diningSubmissions)
			.set({
				accountDeletingAt: input.requestedAt,
				accountDeletionRequestId: input.requestId,
			})
			.where(
				and(
					eq(diningSubmissions.submissionId, row.id),
					isNull(diningSubmissions.accountDeletingAt),
				),
			);
		await tx
			.update(diningSubmissionPhotos)
			.set({ accountDeletionRequestId: input.requestId })
			.where(eq(diningSubmissionPhotos.submissionId, row.id));
	}
	await tx
		.update(diningSubmissionPhotos)
		.set({ accountDeletionRequestId: input.requestId, uploadOwnerId: null })
		.where(eq(diningSubmissionPhotos.uploadOwnerId, input.ownerUserId));
}

export async function isDiningAccountDeletionComplete(
	tx: SubmissionTransaction,
	input: DiningAccountDeletion,
): Promise<boolean> {
	const result = await tx.execute<{ pending: boolean }>(sql`select
		exists(select 1 from dining.submissions where account_deletion_request_id = ${input.requestId})
		or exists(select 1 from dining.submission_photos where account_deletion_request_id = ${input.requestId} or upload_owner_id = ${input.ownerUserId})
		or ${diningAccountIdentityPending(input.ownerUserId)} as pending`);
	return result.rows[0]?.pending === false;
}

export function diningAccountIdentityPending(ownerUserId: string | SQL) {
	return sql<boolean>`(
		exists(select 1 from dining.submissions where author_id = ${ownerUserId}
			or created_by = ${ownerUserId} or updated_by = ${ownerUserId}
			or hidden_by = ${ownerUserId} or deleted_by = ${ownerUserId})
		or exists(select 1 from dining.reviews where author_id = ${ownerUserId}
			or updated_by = ${ownerUserId} or hidden_by = ${ownerUserId} or deleted_by = ${ownerUserId})
		or exists(select 1 from dining.submission_reports where reporter_user_id = ${ownerUserId} or resolved_by = ${ownerUserId})
		or exists(select 1 from dining.review_reports where reporter_user_id = ${ownerUserId} or resolved_by = ${ownerUserId})
		or exists(select 1 from dining.submission_edits where edited_by = ${ownerUserId})
		or exists(select 1 from dining.review_edits where edited_by = ${ownerUserId})
	)`;
}

export async function eraseDiningAccountIdentity(tx: SubmissionTransaction, ownerUserId: string) {
	// Own reviews have reached their target-content cleanup event. Remove their
	// history and reports explicitly, rather than relying on cascading FKs.
	await tx.execute(
		sql`select review_id from dining.reviews where author_id = ${ownerUserId} order by review_id for update`,
	);
	await tx.execute(sql`delete from dining.review_edits where review_id in
		(select review_id from dining.reviews where author_id = ${ownerUserId})`);
	await tx.execute(sql`delete from dining.review_reports where review_id in
		(select review_id from dining.reviews where author_id = ${ownerUserId})`);
	await tx.execute(sql`delete from dining.reviews where author_id = ${ownerUserId}`);
	await tx.execute(sql`update dining.reviews set
		updated_by = case when updated_by = ${ownerUserId} then null else updated_by end,
		hidden_by = case when hidden_by = ${ownerUserId} then null else hidden_by end,
		deleted_by = case when deleted_by = ${ownerUserId} then null else deleted_by end
		where updated_by = ${ownerUserId} or hidden_by = ${ownerUserId} or deleted_by = ${ownerUserId}`);
	await tx.execute(sql`update dining.submissions set
		created_by = case when created_by = ${ownerUserId} then null else created_by end,
		updated_by = case when updated_by = ${ownerUserId} then null else updated_by end,
		hidden_by = case when hidden_by = ${ownerUserId} then null else hidden_by end,
		deleted_by = case when deleted_by = ${ownerUserId} then null else deleted_by end
		where created_by = ${ownerUserId} or updated_by = ${ownerUserId}
			or hidden_by = ${ownerUserId} or deleted_by = ${ownerUserId}`);
	for (const reports of [sql`dining.review_reports`, sql`dining.submission_reports`]) {
		await tx.execute(sql`update ${reports} set
			details = case when reporter_user_id = ${ownerUserId} then null else details end,
			reporter_user_id = case when reporter_user_id = ${ownerUserId} then null else reporter_user_id end,
			resolved_by = case when resolved_by = ${ownerUserId} then null else resolved_by end
			where reporter_user_id = ${ownerUserId} or resolved_by = ${ownerUserId}`);
	}
	await tx.execute(
		sql`update dining.review_edits set edited_by = null where edited_by = ${ownerUserId}`,
	);
	await tx.execute(
		sql`update dining.submission_edits set edited_by = null where edited_by = ${ownerUserId}`,
	);
}

export async function expireDiningHistory(tx: SubmissionTransaction, now: Date) {
	// Formal menu-item review history is permanent; only submission targets expire.
	const submissionReviews = sql`select review_id from dining.reviews where submission_id is not null`;
	await tx.execute(sql`delete from dining.submission_edits where expires_at <= ${now}`);
	await tx.execute(sql`delete from dining.review_edits
		where coalesce(expires_at, edited_at + interval '720 hours') <= ${now}
		and review_id in (${submissionReviews})`);
	await tx.execute(sql`update dining.submission_reports set details = null
		where content_expires_at <= ${now} and details is not null`);
	await tx.execute(sql`update dining.review_reports set details = null
		where coalesce(content_expires_at, created_at + interval '720 hours') <= ${now} and details is not null
		and review_id in (${submissionReviews})`);
}

// Caller holds each parent lock. This makes text/identity unavailable even if a
// subsequent remote deletion fails; the request ID retains cleanup responsibility.
export async function clearSubmissionContent(tx: SubmissionTransaction, submissionId: string) {
	await tx.execute(sql`delete from dining.submission_edits where submission_id = ${submissionId}`);
	await tx.execute(
		sql`delete from dining.submission_reports where submission_id = ${submissionId}`,
	);
	await tx
		.update(diningSubmissions)
		.set({
			name: null,
			priceText: null,
			authorId: null,
			authorDisplayName: null,
			createdBy: null,
			updatedBy: null,
			hiddenBy: null,
			deletedBy: null,
			createdInputSha256: null,
			createdName: null,
			createdPhotoAction: null,
			createdPriceText: null,
			idempotencyKey: null,
			windowId: null,
			status: "expired",
		})
		.where(eq(diningSubmissions.submissionId, submissionId));
}

export async function removeExpiredDependentReviews(tx: SubmissionTransaction, now: Date) {
	const expired = sql`select r.review_id from dining.reviews r join dining.submissions s
		on s.submission_id = r.submission_id
		where s.purged_at + interval '720 hours' <= ${now}`;
	await tx.execute(
		sql`select review_id from dining.reviews where review_id in (${expired}) order by review_id for update`,
	);
	await tx.execute(sql`delete from dining.review_edits where review_id in (${expired})`);
	await tx.execute(sql`delete from dining.review_reports where review_id in (${expired})`);
	await tx.execute(sql`delete from dining.reviews where review_id in (${expired})`);
	await tx.execute(sql`delete from dining.submissions s where s.purged_at is not null
		and s.account_deletion_request_id is null
		and not exists(select 1 from dining.reviews r where r.submission_id = s.submission_id)
		and not exists(select 1 from dining.submission_photos p where p.submission_id = s.submission_id)
		and not exists(select 1 from dining.submission_edits e where e.submission_id = s.submission_id)
		and not exists(select 1 from dining.submission_reports r where r.submission_id = s.submission_id)`);
}
