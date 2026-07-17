import { Client } from "pg";

import type { DiningSourceObservation } from "./catalog-source-types";

type DiningPublisherClient = Pick<Client, "connect" | "end" | "query">;

export class PostgresDiningReviewPublisher {
	constructor(
		private readonly databaseUrl: string,
		private readonly createClient: (databaseUrl: string) => DiningPublisherClient = (databaseUrl) =>
			new Client({ connectionString: databaseUrl }),
	) {}

	async publishReviewObservations(observations: DiningSourceObservation[]): Promise<number> {
		const client = this.createClient(this.databaseUrl);
		await client.connect();
		try {
			await client.query("BEGIN");
			const before = await publishedDigest(client);
			const activeReviewIds: string[] = [];
			for (const observation of observations) {
				if (observation.sourceType !== "feishu_review") continue;
				const payload = observation.payloadJson;
				const submittedAt = optionalDate(payload.submittedAt);
				if (!submittedAt) continue;
				const reviewId = requiredString(payload.reviewId, "reviewId");
				activeReviewIds.push(reviewId);
				const overrideResult = await client.query(
					"SELECT offering_id, visibility FROM dining.review_overrides WHERE review_id = $1",
					[reviewId],
				);
				const override = overrideResult.rows[0];
				const accepted = observation.status === "accepted";
				const requestedOfferingId =
					optionalString(override?.offering_id) ?? optionalString(payload.offeringId);
				const binding = requestedOfferingId
					? await loadOfferingBinding(client, requestedOfferingId)
					: null;
				const requestedVisibility = optionalString(override?.visibility);
				const visibility =
					accepted && binding && requestedVisibility !== "hidden" ? "published" : "hidden";
				await client.query(
					`INSERT INTO dining.reviews(
						review_id,source_record_id,campus,hall_name,stall_name,dish_name,paid_price_label,
						rating,comment,contributor_name,images_json,submitted_at,moderation_status,visibility,
						hall_id,stall_profile_id,window_id,offering_id,published_at,created_at,updated_at
					) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
						CASE WHEN $14 = 'published' THEN now() ELSE NULL END,now(),now())
					ON CONFLICT(review_id) DO UPDATE SET
						moderation_status = EXCLUDED.moderation_status,
						visibility = EXCLUDED.visibility,
						hall_id = EXCLUDED.hall_id,
						stall_profile_id = EXCLUDED.stall_profile_id,
						window_id = EXCLUDED.window_id,
						offering_id = EXCLUDED.offering_id,
						published_at = CASE
							WHEN EXCLUDED.visibility = 'published' THEN COALESCE(dining.reviews.published_at, now())
							ELSE NULL
						END,
						updated_at = CASE
							WHEN dining.reviews.moderation_status IS DISTINCT FROM EXCLUDED.moderation_status
								OR dining.reviews.visibility IS DISTINCT FROM EXCLUDED.visibility
								OR dining.reviews.offering_id IS DISTINCT FROM EXCLUDED.offering_id
							THEN now() ELSE dining.reviews.updated_at
						END`,
					[
						reviewId,
						requiredString(payload.sourceRecordId, "sourceRecordId"),
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
						accepted ? "safe" : "blocked",
						visibility,
						binding?.hallId ?? null,
						binding?.stallProfileId ?? null,
						binding?.windowId ?? null,
						binding?.offeringId ?? null,
					],
				);
			}
			await client.query(
				`UPDATE dining.reviews SET visibility = 'hidden', published_at = NULL, updated_at = now()
				WHERE review_id <> ALL($1::text[])
					AND visibility = 'published'`,
				[activeReviewIds],
			);
			const after = await publishedDigest(client);
			if (before !== after) {
				await client.query(
					"UPDATE dining.publication SET review_revision = review_revision + 1, updated_at = now() WHERE scope = 'global'",
				);
			}
			const revisionResult = await client.query(
				"SELECT review_revision FROM dining.publication WHERE scope = 'global'",
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
	WHERE visibility = 'published' AND moderation_status = 'safe'`);
	return String(result.rows[0]?.value ?? "[]");
}

interface ReviewOfferingBinding {
	hallId: string;
	offeringId: string;
	stallProfileId: string;
	windowId: string;
}

async function loadOfferingBinding(
	client: Pick<Client, "query">,
	offeringId: string,
): Promise<ReviewOfferingBinding | null> {
	const result = await client.query(
		`SELECT offering.offering_id, assignment.stall_profile_id, assignment.window_id, window.hall_id
			FROM dining.menu_offerings AS offering
			JOIN dining.window_assignments AS assignment
				ON assignment.assignment_id = offering.assignment_id
			JOIN dining.windows AS window ON window.window_id = assignment.window_id
			WHERE offering.offering_id = $1`,
		[offeringId],
	);
	const row = result.rows[0];
	return row
		? {
				hallId: String(row.hall_id),
				offeringId: String(row.offering_id),
				stallProfileId: String(row.stall_profile_id),
				windowId: String(row.window_id),
			}
		: null;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid dining review ${field}.`);
	return value;
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function optionalNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalDate(value: unknown): Date | null {
	if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) return null;
	return new Date(value);
}
