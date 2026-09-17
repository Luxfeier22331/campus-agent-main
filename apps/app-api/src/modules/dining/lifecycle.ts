import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Env } from "../../config";
import type { RuntimeDbGetter } from "../../db/runtime";
import {
	accountDeletionRequests,
	diningSubmissionPhotos,
	diningSubmissions,
	user,
} from "../../db/schema";
import { createDiningMediaCleanup } from "./lifecycle-media";
import {
	clearSubmissionContent,
	type DiningAccountDeletion,
	diningAccountIdentityPending,
	eraseDiningAccountIdentity,
	expireDiningHistory,
	isDiningAccountDeletionComplete,
	removeExpiredDependentReviews,
} from "./lifecycle-store";
import type { DiningSubmissionObjects } from "./submission-media";
import { createDiningSubmissionObjects } from "./submission-objects";

export interface DiningLifecycleService {
	sweep(): Promise<void>;
	eraseForAccountDeletion(input: DiningAccountDeletion): Promise<boolean>;
}

export function createPgDiningLifecycleService(
	env: Env,
	options: {
		getDb: RuntimeDbGetter;
		now?: () => Date;
		objects?: DiningSubmissionObjects;
	},
): DiningLifecycleService {
	const getDb = options.getDb;
	const now = options.now ?? (() => new Date());
	const media = createDiningMediaCleanup({
		getDb,
		now,
		objects: () => options.objects ?? createDiningSubmissionObjects(env),
	});

	async function eraseIdentity(input: DiningAccountDeletion) {
		const db = await getDb();
		await db.transaction(async (tx) => {
			await tx
				.select({ id: user.id })
				.from(user)
				.where(eq(user.id, input.ownerUserId))
				.for("update");
			await eraseDiningAccountIdentity(tx, input.ownerUserId);
		});
	}

	async function cleanup(requestId?: string) {
		const db = await getDb();
		const at = now();
		const errors: unknown[] = [];
		const eligible = and(
			isNull(diningSubmissions.purgedAt),
			or(
				isNotNull(diningSubmissions.accountDeletingAt),
				and(
					lte(diningSubmissions.expiresAt, at),
					or(eq(diningSubmissions.status, "deleted"), eq(diningSubmissions.status, "expired")),
				),
			),
			requestId ? eq(diningSubmissions.accountDeletionRequestId, requestId) : undefined,
		);
		const rows = await db
			.select({ id: diningSubmissions.submissionId })
			.from(diningSubmissions)
			.where(eligible)
			.orderBy(
				sql`case when ${diningSubmissions.status} = 'expired' then 1 else 0 end`,
				asc(diningSubmissions.submissionId),
			)
			.limit(100);
		for (const row of rows) {
			try {
				await db.transaction(async (tx) => {
					const [current] = await tx
						.select()
						.from(diningSubmissions)
						.where(and(eq(diningSubmissions.submissionId, row.id), eligible))
						.for("update");
					if (current) {
						await clearSubmissionContent(tx, row.id);
					}
				});
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			const result = await media.sweep(requestId ? { accountDeletionRequestId: requestId } : {});
			if (result.failed) {
				errors.push(new Error("dining_media_cleanup_failed"));
			}
		} catch (error) {
			errors.push(error);
		}
		const finalizable = await db
			.select({ id: diningSubmissions.submissionId })
			.from(diningSubmissions)
			.where(
				and(
					eq(diningSubmissions.status, "expired"),
					isNull(diningSubmissions.name),
					requestId ? eq(diningSubmissions.accountDeletionRequestId, requestId) : undefined,
					sql`not exists(select 1 from dining.submission_photos p where p.submission_id = ${diningSubmissions.submissionId})`,
				),
			)
			.orderBy(diningSubmissions.submissionId)
			.limit(100);
		for (const row of finalizable) {
			try {
				await db.transaction(async (tx) => {
					const [current] = await tx
						.select()
						.from(diningSubmissions)
						.where(eq(diningSubmissions.submissionId, row.id))
						.for("update");
					if (current?.status !== "expired" || current.name !== null) {
						return;
					}
					const [photo] = await tx
						.select({ id: diningSubmissionPhotos.photoId })
						.from(diningSubmissionPhotos)
						.where(eq(diningSubmissionPhotos.submissionId, row.id))
						.limit(1);
					if (photo) {
						return;
					}
					await tx
						.update(diningSubmissions)
						.set({
							status: "purged",
							purgedAt: now(),
							accountDeletionRequestId: null,
							accountDeletingAt: null,
							hiddenAt: null,
							deletedAt: null,
							expiresAt: null,
						})
						.where(eq(diningSubmissions.submissionId, row.id));
				});
			} catch (error) {
				errors.push(error);
			}
		}
		for (const cleanText of [expireDiningHistory, removeExpiredDependentReviews]) {
			try {
				await db.transaction((tx) => cleanText(tx, at));
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length > 0) {
			throw new AggregateError(errors, "Dining cleanup failed");
		}
	}

	return {
		async sweep() {
			const db = await getDb();
			const pending = await db
				.select({
					ownerUserId: accountDeletionRequests.ownerUserId,
					requestId: accountDeletionRequests.requestId,
				})
				.from(accountDeletionRequests)
				.where(
					and(
						eq(accountDeletionRequests.status, "pending"),
						isNotNull(accountDeletionRequests.ownerUserId),
						diningAccountIdentityPending(sql`${accountDeletionRequests.ownerUserId}`),
					),
				)
				.orderBy(accountDeletionRequests.requestedAt)
				.limit(20);
			const errors: unknown[] = [];
			for (const request of pending) {
				try {
					if (request.ownerUserId) {
						await eraseIdentity({ ...request, ownerUserId: request.ownerUserId });
					}
				} catch (error) {
					errors.push(error);
				}
			}
			try {
				await cleanup();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length > 0) {
				throw new AggregateError(errors, "Dining cleanup failed");
			}
		},
		async eraseForAccountDeletion(input) {
			await eraseIdentity(input);
			await cleanup(input.requestId);
			const db = await getDb();
			return db.transaction((tx) => isDiningAccountDeletionComplete(tx, input));
		},
	};
}
