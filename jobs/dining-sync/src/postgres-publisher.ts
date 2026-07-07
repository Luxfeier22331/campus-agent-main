import { Client } from "pg";

import type { DiningReviewProjection } from "./types";

export class PostgresDiningReviewPublisher {
	private readonly databaseUrl: string;

	constructor(databaseUrl: string) {
		this.databaseUrl = databaseUrl;
	}

	async publishReviews(reviews: DiningReviewProjection[]): Promise<void> {
		const client = new Client({ connectionString: this.databaseUrl });
		await client.connect();
		try {
			await client.query("BEGIN");
			await client.query('DELETE FROM "dining"."review_projections"');
			for (const review of reviews) {
				await client.query(
					`INSERT INTO "dining"."review_projections" (
						"review_id",
						"source_record_id",
						"campus",
						"hall_id",
						"hall_name",
						"stall_profile_id",
						"window_id",
						"stall_name",
						"dish_name",
						"paid_price_label",
						"rating",
						"comment",
						"contributor_name",
						"images_json",
						"published_at"
						) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
					[
						review.reviewId,
						review.sourceRecordId,
						review.campus,
						review.hallId,
						review.hallName,
						review.stallProfileId,
						review.windowId,
						review.stallName,
						review.dishName,
						review.paidPriceLabel,
						review.rating,
						review.comment,
						review.contributorName,
						JSON.stringify(review.images),
					],
				);
			}
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			await client.end();
		}
	}
}
