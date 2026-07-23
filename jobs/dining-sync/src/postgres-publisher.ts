import { parseDiningPublishedSnapshot } from "@campus-agent/dining/domain";
import { Client } from "pg";

import type { DiningSourceObservation } from "./catalog-source-types.ts";
import { PublishedDiningReviewResolver } from "./review-resolver.ts";

type DiningPublisherClient = Pick<Client, "connect" | "end" | "query">;

export class PostgresDiningReviewPublisher {
	private readonly createClient: (databaseUrl: string) => DiningPublisherClient;
	private readonly databaseUrl: string;

	constructor(
		databaseUrl: string,
		createClient: (databaseUrl: string) => DiningPublisherClient = (databaseUrl) =>
			new Client({ connectionString: databaseUrl }),
	) {
		this.databaseUrl = databaseUrl;
		this.createClient = createClient;
	}

	async publishReviewObservations(
		observations: DiningSourceObservation[],
		expectedCatalogReleaseId: string,
	): Promise<number> {
		const client = this.createClient(this.databaseUrl);
		await client.connect();
		try {
			await client.query("BEGIN");
			const snapshotResult = await client.query(
				`SELECT p.catalog_release_id,r.payload_json,r.snapshot_hash
				 FROM dining.publication p
				 JOIN dining.releases r ON r.release_id=p.catalog_release_id
				 WHERE p.scope='global' FOR UPDATE OF p`,
			);
			const snapshotRow = snapshotResult.rows[0];
			if (snapshotRow?.catalog_release_id !== expectedCatalogReleaseId) {
				throw new Error("Dining catalog release changed while reviews were being processed.");
			}
			const snapshot = parseDiningPublishedSnapshot(snapshotRow.payload_json, {
				releaseId: expectedCatalogReleaseId,
				snapshotHash: String(snapshotRow.snapshot_hash),
			});
			const resolver = new PublishedDiningReviewResolver(snapshot);
			const before = await publishedDigest(client);
			const activeReviewIds: string[] = [];
			for (const observation of observations) {
				if (observation.sourceType !== "feishu_review") {
					continue;
				}
				const payload = observation.payloadJson;
				const reviewId = requiredString(payload.reviewId, "reviewId");
				activeReviewIds.push(reviewId);
				const accepted = observation.status === "accepted";
				if (!accepted) {
					await client.query(
						`UPDATE dining.reviews SET moderation_status='blocked',visibility='hidden',
							published_at=NULL,updated_at=CASE WHEN moderation_status <> 'blocked'
								OR visibility <> 'hidden' THEN now() ELSE updated_at END
						 WHERE review_id=$1`,
						[reviewId],
					);
					continue;
				}
				const submittedAt = requiredDate(payload.submittedAt, "submittedAt");
				const overrideResult = await client.query(
					"SELECT offering_id,visibility FROM dining.review_overrides WHERE review_id=$1",
					[reviewId],
				);
				const override = overrideResult.rows[0];
				const requestedOfferingId =
					optionalString(override?.offering_id) ?? requiredString(payload.offeringId, "offeringId");
				const binding = resolver.resolveOfferingId(requestedOfferingId);
				const requestedVisibility = optionalString(override?.visibility);
				const visibility = binding && requestedVisibility !== "hidden" ? "published" : "hidden";
				await client.query(
					`INSERT INTO dining.reviews(
						review_id,source_record_id,source_hash,campus,hall_name,stall_name,dish_name,
						paid_price_label,rating,comment,contributor_name,images_json,submitted_at,
						moderation_status,visibility,hall_id,stall_profile_id,window_id,offering_id,
						published_at,created_at,updated_at
					) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'safe',$14,$15,$16,$17,$18,
						CASE WHEN $14='published' THEN now() ELSE NULL END,now(),now())
					ON CONFLICT(review_id) DO UPDATE SET
						source_hash=EXCLUDED.source_hash,campus=EXCLUDED.campus,hall_name=EXCLUDED.hall_name,
						stall_name=EXCLUDED.stall_name,dish_name=EXCLUDED.dish_name,
						paid_price_label=EXCLUDED.paid_price_label,rating=EXCLUDED.rating,
						comment=EXCLUDED.comment,contributor_name=EXCLUDED.contributor_name,
						images_json=EXCLUDED.images_json,submitted_at=EXCLUDED.submitted_at,
						moderation_status='safe',visibility=EXCLUDED.visibility,hall_id=EXCLUDED.hall_id,
						stall_profile_id=EXCLUDED.stall_profile_id,window_id=EXCLUDED.window_id,
						offering_id=EXCLUDED.offering_id,
						published_at=CASE WHEN EXCLUDED.visibility='published'
							THEN COALESCE(dining.reviews.published_at,now()) ELSE NULL END,
						updated_at=CASE WHEN dining.reviews.source_hash IS DISTINCT FROM EXCLUDED.source_hash
							OR dining.reviews.visibility IS DISTINCT FROM EXCLUDED.visibility
							OR dining.reviews.offering_id IS DISTINCT FROM EXCLUDED.offering_id
							OR dining.reviews.moderation_status <> 'safe' THEN now()
							ELSE dining.reviews.updated_at END`,
					[
						reviewId,
						requiredString(payload.sourceRecordId, "sourceRecordId"),
						requiredString(payload.sourceHash, "sourceHash"),
						requiredString(payload.campus, "campus"),
						requiredString(payload.hallName, "hallName"),
						requiredString(payload.stallName, "stallName"),
						requiredString(payload.dishName, "dishName"),
						optionalString(payload.paidPriceLabel),
						optionalNumber(payload.rating),
						optionalString(payload.comment),
						optionalString(payload.contributorName),
						JSON.stringify(Array.isArray(payload.images) ? payload.images : []),
						submittedAt,
						visibility,
						binding?.hallId ?? null,
						binding?.stallProfileId ?? null,
						binding?.windowId ?? null,
						binding?.offeringId ?? null,
					],
				);
			}
			await client.query(
				`UPDATE dining.reviews SET visibility='hidden',published_at=NULL,
					updated_at=CASE WHEN visibility='published' THEN now() ELSE updated_at END
				 WHERE NOT (review_id=ANY($1::text[])) AND visibility='published'`,
				[activeReviewIds],
			);
			const after = await publishedDigest(client);
			if (before !== after) {
				await client.query(
					"UPDATE dining.publication SET review_revision=review_revision+1,updated_at=now() WHERE scope='global'",
				);
			}
			const revisionResult = await client.query(
				"SELECT review_revision FROM dining.publication WHERE scope='global'",
			);
			await client.query("COMMIT");
			return Number(revisionResult.rows[0]?.review_revision ?? 0);
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			await client.end();
		}
	}
}

async function publishedDigest(client: Pick<Client, "query">): Promise<string> {
	const result = await client.query(`SELECT COALESCE(jsonb_agg(jsonb_build_array(
		review_id,comment,contributor_name,images_json,paid_price_label,rating,submitted_at,
		hall_id,stall_profile_id,window_id,offering_id
	) ORDER BY review_id), '[]'::jsonb)::text AS value FROM dining.reviews
	WHERE visibility='published' AND moderation_status='safe'`);
	return String(result.rows[0]?.value ?? "[]");
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Invalid dining review ${field}.`);
	}
	return value;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function optionalNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function requiredDate(value: unknown, field: string): Date {
	if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) {
		throw new Error(`Invalid dining review ${field}.`);
	}
	return new Date(value);
}
