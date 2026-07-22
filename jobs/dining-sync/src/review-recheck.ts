import { Client } from "pg";

import type { ModerationResult } from "./types.ts";

type DiningRecheckClient = Pick<Client, "connect" | "end" | "query">;

export async function processDiningReviewRechecks(input: {
	createClient?: (databaseUrl: string) => DiningRecheckClient;
	databaseUrl: string;
	moderator: { check(input: { comment: string | null; contributorName: string | null; dishName: string; stallName: string }): Promise<ModerationResult> };
}): Promise<{ processed: number; publishedChanged: boolean }> {
	const client = input.createClient?.(input.databaseUrl) ?? new Client({ connectionString: input.databaseUrl });
	await client.connect();
	let processed = 0;
	let publishedChanged = false;
	try {
		const before = await publishedDigest(client);
		const requests = await client.query(`SELECT q.request_id, r.*
			FROM dining.review_recheck_requests q
			JOIN dining.reviews r ON r.review_id = q.review_id
			WHERE q.status = 'pending' ORDER BY q.requested_at LIMIT 100`);
		for (const row of requests.rows) {
			try {
				const moderation = await input.moderator.check({
					comment: typeof row.comment === "string" ? row.comment : null,
					contributorName: typeof row.contributor_name === "string" ? row.contributor_name : null,
					dishName: String(row.dish_name),
					stallName: String(row.stall_name),
				});
				await client.query("BEGIN");
				const override = await client.query("SELECT visibility FROM dining.review_overrides WHERE review_id=$1", [row.review_id]);
				const safe = moderation.status === "safe";
				const requestedVisibility = override.rows[0]?.visibility;
				const hasExactBinding = Boolean(
					row.hall_id && row.stall_profile_id && row.window_id && row.offering_id,
				);
				const nextVisibility = !safe || !hasExactBinding
					? "hidden"
					: requestedVisibility === "hidden"
						? "hidden"
						: "published";
				await client.query(`UPDATE dining.reviews SET moderation_status=$1,visibility=$2,
					published_at=CASE WHEN $2='published' THEN COALESCE(published_at,now()) ELSE NULL END,
					updated_at=now() WHERE review_id=$3`, [moderation.status, nextVisibility, row.review_id]);
				await client.query("UPDATE dining.review_recheck_requests SET status='completed',completed_at=now(),error_message=NULL WHERE request_id=$1", [row.request_id]);
				await client.query("COMMIT");
				processed += 1;
			} catch (error) {
				await client.query("ROLLBACK").catch(() => undefined);
				await client.query("UPDATE dining.review_recheck_requests SET status='failed',completed_at=now(),error_message=$2 WHERE request_id=$1", [row.request_id, error instanceof Error ? error.message.slice(0, 500) : "Review recheck failed."]);
			}
		}
		publishedChanged = before !== await publishedDigest(client);
		if (publishedChanged) {
			await client.query("UPDATE dining.publication SET review_revision=review_revision+1,updated_at=now() WHERE scope='global'");
		}
		return { processed, publishedChanged };
	} finally {
		await client.end();
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
