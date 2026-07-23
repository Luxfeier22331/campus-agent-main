import { randomUUID } from "node:crypto";
import type { DiningOpsActor } from "@campus-agent/dining/domain";
import {
	parseDiningPublishedSnapshot,
	resolveDiningPublishedOffering,
} from "@campus-agent/dining/domain";

import {
	type DiningPool,
	type DiningQuery,
	DiningStoreNotFoundError,
	DiningStoreValidationError,
	diningDateIso,
	withDiningTransaction,
	writeDiningEvent,
} from "./dining-store-repository.ts";

export interface DiningOpsReview {
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	moderationStatus: string;
	offeringId: string | null;
	rating: number | null;
	reviewId: string;
	stallName: string;
	submittedAt: string;
	visibility: string;
}

export type DiningReviewCommand =
	| { kind: "hide"; reason: string }
	| { kind: "restore"; reason: string }
	| { kind: "rebind"; offeringId: string; reason: string }
	| { kind: "recheck" };

export interface DiningReviewStoreMethods {
	applyReviewCommand(
		actor: DiningOpsActor,
		reviewId: string,
		command: DiningReviewCommand,
	): Promise<void>;
	getReview(reviewId: string): Promise<DiningOpsReview | null>;
	listReviews(limit: number): Promise<DiningOpsReview[]>;
}

export function createDiningReviewStore(pool: DiningPool): DiningReviewStoreMethods {
	return {
		async listReviews(limit) {
			const result = await pool.query(
				"SELECT * FROM dining.reviews ORDER BY submitted_at DESC LIMIT $1",
				[limit],
			);
			return result.rows.map(rowToReview);
		},
		async getReview(reviewId) {
			const result = await pool.query("SELECT * FROM dining.reviews WHERE review_id=$1", [
				reviewId,
			]);
			return result.rows[0] ? rowToReview(result.rows[0]) : null;
		},
		async applyReviewCommand(actor, reviewId, command) {
			await withDiningTransaction(pool, async (client) => {
				const before = await publishedReviewDigest(client, reviewId);
				const review = await client.query(
					`SELECT review_id,moderation_status,hall_id,stall_profile_id,window_id,offering_id
					 FROM dining.reviews WHERE review_id=$1`,
					[reviewId],
				);
				if (!review.rows[0]) {
					throw new DiningStoreNotFoundError("review");
				}
				if (
					command.kind === "restore" &&
					(review.rows[0].moderation_status !== "safe" ||
						!review.rows[0].hall_id ||
						!review.rows[0].stall_profile_id ||
						!review.rows[0].window_id ||
						!review.rows[0].offering_id)
				) {
					throw new DiningStoreValidationError(
						"Only safe reviews with an exact offering binding can be restored.",
					);
				}

				const binding =
					command.kind === "rebind"
						? await loadReviewOfferingBinding(client, command.offeringId)
						: null;
				if (command.kind === "rebind" && !binding) {
					throw new DiningStoreValidationError(
						"Review target offering does not exist in the published catalog.",
					);
				}

				if (command.kind === "recheck") {
					await client.query(
						"INSERT INTO dining.review_recheck_requests(request_id,review_id,status,attempt_count,available_at,requested_at,requested_by) VALUES($1,$2,'pending',0,now(),now(),$3)",
						[`review_recheck:${randomUUID()}`, reviewId, actor.principalId],
					);
				} else {
					const offeringId = command.kind === "rebind" ? command.offeringId : null;
					const visibility =
						command.kind === "hide" ? "hidden" : command.kind === "restore" ? "published" : null;
					await client.query(
						`INSERT INTO dining.review_overrides(review_id,offering_id,visibility,reason,updated_at,updated_by)
						 VALUES($1,$2,$3,$4,now(),$5) ON CONFLICT(review_id) DO UPDATE SET
						 offering_id=COALESCE(EXCLUDED.offering_id,dining.review_overrides.offering_id),
						 visibility=COALESCE(EXCLUDED.visibility,dining.review_overrides.visibility),
						 reason=EXCLUDED.reason,updated_at=now(),updated_by=EXCLUDED.updated_by`,
						[reviewId, offeringId, visibility, command.reason, actor.principalId],
					);
					if (binding) {
						await client.query(
							`UPDATE dining.reviews SET hall_id=$1,stall_profile_id=$2,window_id=$3,
							 offering_id=$4,updated_at=now() WHERE review_id=$5`,
							[
								binding.hallId,
								binding.stallProfileId,
								binding.windowId,
								binding.offeringId,
								reviewId,
							],
						);
					}
					if (visibility) {
						await client.query(
							"UPDATE dining.reviews SET visibility=$1,published_at=CASE WHEN $1='published' THEN COALESCE(published_at,now()) ELSE NULL END,updated_at=now() WHERE review_id=$2",
							[visibility, reviewId],
						);
					}
					if (before !== (await publishedReviewDigest(client, reviewId))) {
						await client.query(
							"UPDATE dining.publication SET review_revision=review_revision+1,updated_at=now() WHERE scope='global'",
						);
					}
				}
				await writeDiningEvent(client, actor, `review.${command.kind}`, "review", reviewId, {});
			});
		},
	};
}

export async function loadReviewOfferingBinding(db: DiningQuery, offeringId: string) {
	const result = await db.query(
		`SELECT publication.catalog_release_id, release.payload_json, release.snapshot_hash
		 FROM dining.publication AS publication
		 JOIN dining.releases AS release ON release.release_id = publication.catalog_release_id
		 WHERE publication.scope = 'global'
		 FOR UPDATE OF publication`,
	);
	const row = result.rows[0];
	if (!(row?.catalog_release_id && row.payload_json && row.snapshot_hash)) {
		throw new DiningStoreValidationError(
			"Dining has no valid published catalog for review binding.",
		);
	}
	const snapshot = parseDiningPublishedSnapshot(row.payload_json, {
		releaseId: String(row.catalog_release_id),
		snapshotHash: String(row.snapshot_hash),
	});
	return resolveDiningPublishedOffering(snapshot, offeringId);
}

async function publishedReviewDigest(db: DiningQuery, reviewId: string): Promise<string> {
	const result = await db.query(
		`SELECT CASE WHEN visibility = 'published' AND moderation_status = 'safe' THEN
		 jsonb_build_array(review_id,comment,contributor_name,images_json,paid_price_label,rating,
		 submitted_at,hall_id,stall_profile_id,window_id,offering_id)::text ELSE 'hidden' END AS value
		 FROM dining.reviews WHERE review_id = $1`,
		[reviewId],
	);
	return String(result.rows[0]?.value ?? "missing");
}

function rowToReview(row: Record<string, unknown>): DiningOpsReview {
	return {
		comment: typeof row.comment === "string" ? row.comment : null,
		contributorName: typeof row.contributor_name === "string" ? row.contributor_name : null,
		dishName: String(row.dish_name),
		moderationStatus: String(row.moderation_status),
		offeringId: typeof row.offering_id === "string" ? row.offering_id : null,
		rating: typeof row.rating === "number" ? row.rating : null,
		reviewId: String(row.review_id),
		stallName: String(row.stall_name),
		submittedAt: diningDateIso(row.submitted_at),
		visibility: String(row.visibility),
	};
}
