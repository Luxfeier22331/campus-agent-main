import { Client } from "pg";

import type { DiningReviewImage, ModerationResult } from "./types.ts";

type DiningRecheckClient = Pick<Client, "connect" | "end" | "query">;
const RECHECK_BATCH_SIZE = 20;
const RECHECK_MAX_ATTEMPTS = 3;

interface ClaimedReview {
	attemptCount: number;
	comment: string | null;
	contributorName: string | null;
	dishName: string;
	images: DiningReviewImage[];
	requestId: string;
	reviewId: string;
	stallName: string;
}

type RecheckResult =
	| { claim: ClaimedReview; moderationStatus: ModerationResult["status"]; status: "completed" }
	| { claim: ClaimedReview; error: string; status: "failed" };

export async function processDiningReviewRechecks(input: {
	createClient?: (databaseUrl: string) => DiningRecheckClient;
	databaseUrl: string;
	moderator: {
		check(input: {
			comment: string | null;
			contributorName: string | null;
			dishName: string;
			stallName: string;
		}): Promise<ModerationResult>;
		checkImage(input: { url: string }): Promise<ModerationResult>;
	};
}): Promise<{ processed: number; publishedChanged: boolean; retried: number }> {
	const client =
		input.createClient?.(input.databaseUrl) ?? new Client({ connectionString: input.databaseUrl });
	await client.connect();
	try {
		const claims = await claimRequests(client);
		const results: RecheckResult[] = [];
		for (const claim of claims) {
			try {
				const text = await input.moderator.check({
					comment: claim.comment,
					contributorName: claim.contributorName,
					dishName: claim.dishName,
					stallName: claim.stallName,
				});
				let status = text.status;
				if (status === "safe") {
					for (const image of claim.images) {
						const result = await input.moderator.checkImage({ url: image.url });
						if (result.status !== "safe") {
							status = result.status;
							break;
						}
					}
				}
				results.push({ claim, moderationStatus: status, status: "completed" });
			} catch (error) {
				results.push({
					claim,
					error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
					status: "failed",
				});
			}
		}

		await client.query("BEGIN");
		try {
			const before = await publishedDigest(client);
			let retried = 0;
			for (const result of results) {
				if (result.status === "failed") {
					if (result.claim.attemptCount < RECHECK_MAX_ATTEMPTS) {
						await client.query(
							`UPDATE dining.review_recheck_requests SET status='pending',claimed_at=NULL,
								available_at=now()+($2::int * interval '5 minutes'),error_message=$3
							 WHERE request_id=$1`,
							[result.claim.requestId, result.claim.attemptCount, result.error],
						);
						retried += 1;
					} else {
						await client.query(
							`UPDATE dining.review_recheck_requests SET status='failed',completed_at=now(),
								error_message=$2 WHERE request_id=$1`,
							[result.claim.requestId, result.error],
						);
					}
					continue;
				}
				const override = await client.query(
					"SELECT visibility FROM dining.review_overrides WHERE review_id=$1",
					[result.claim.reviewId],
				);
				const binding = await client.query(
					`SELECT hall_id,stall_profile_id,window_id,offering_id FROM dining.reviews
					 WHERE review_id=$1`,
					[result.claim.reviewId],
				);
				const review = binding.rows[0];
				const safe = result.moderationStatus === "safe";
				const hasExactBinding = Boolean(
					review?.hall_id && review.stall_profile_id && review.window_id && review.offering_id,
				);
				const visibility =
					safe && hasExactBinding && override.rows[0]?.visibility !== "hidden"
						? "published"
						: "hidden";
				await client.query(
					`UPDATE dining.reviews SET moderation_status=$1,visibility=$2,
						published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE NULL END,
						updated_at=now() WHERE review_id=$3`,
					[result.moderationStatus, visibility, result.claim.reviewId],
				);
				await client.query(
					`UPDATE dining.review_recheck_requests SET status='completed',completed_at=now(),
						error_message=NULL WHERE request_id=$1`,
					[result.claim.requestId],
				);
			}
			const publishedChanged = before !== (await publishedDigest(client));
			if (publishedChanged) {
				await client.query(
					"UPDATE dining.publication SET review_revision=review_revision+1,updated_at=now() WHERE scope='global'",
				);
			}
			await client.query("COMMIT");
			return { processed: results.length - retried, publishedChanged, retried };
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		}
	} finally {
		await client.end();
	}
}

async function claimRequests(client: DiningRecheckClient): Promise<ClaimedReview[]> {
	await client.query("BEGIN");
	try {
		await client.query(
			`UPDATE dining.review_recheck_requests SET status='pending',claimed_at=NULL,available_at=now(),
				error_message='Previous review recheck worker stopped before completion.'
			 WHERE status='processing' AND claimed_at < now()-interval '10 minutes'`,
		);
		const result = await client.query(
			`WITH candidates AS (
				SELECT request_id FROM dining.review_recheck_requests
				WHERE status='pending' AND available_at<=now()
				ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT $1
			), claimed AS (
				UPDATE dining.review_recheck_requests q SET status='processing',claimed_at=now(),
					attempt_count=attempt_count+1
				FROM candidates c WHERE q.request_id=c.request_id RETURNING q.*
			)
			SELECT c.request_id,c.review_id,c.attempt_count,r.comment,r.contributor_name,
				r.dish_name,r.stall_name,r.images_json
			FROM claimed c JOIN dining.reviews r ON r.review_id=c.review_id`,
			[RECHECK_BATCH_SIZE],
		);
		await client.query("COMMIT");
		return result.rows.map((row) => ({
			attemptCount: Number(row.attempt_count),
			comment: nullableString(row.comment),
			contributorName: nullableString(row.contributor_name),
			dishName: String(row.dish_name),
			images: parseImages(row.images_json),
			requestId: String(row.request_id),
			reviewId: String(row.review_id),
			stallName: String(row.stall_name),
		}));
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

async function publishedDigest(client: Pick<Client, "query">): Promise<string> {
	const result = await client.query(`SELECT COALESCE(jsonb_agg(jsonb_build_array(
		review_id,comment,contributor_name,images_json,paid_price_label,rating,submitted_at,
		hall_id,stall_profile_id,window_id,offering_id
	) ORDER BY review_id), '[]'::jsonb)::text AS value
	FROM dining.reviews WHERE visibility='published' AND moderation_status='safe'`);
	return String(result.rows[0]?.value ?? "[]");
}

function parseImages(value: unknown): DiningReviewImage[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			return [];
		}
		const image = item as Record<string, unknown>;
		return typeof image.url === "string" && typeof image.imageId === "string"
			? [
					{
						alt: typeof image.alt === "string" ? image.alt : "评价图片",
						imageId: image.imageId,
						url: image.url,
					},
				]
			: [];
	});
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}
