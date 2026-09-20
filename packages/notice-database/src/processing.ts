import type { Pool, PoolClient } from "pg";

export type NoticeProcessingStage = "classification" | "publication";

export async function recordAutomaticClassificationFailure(
	database: Pick<Pool, "query">,
	noticeId: number,
	error: Error,
): Promise<void> {
	await database.query(
		`WITH eligible AS (
			SELECT notice_id FROM notices.notices
			WHERE notice_id=$1 AND category IS NULL FOR UPDATE
		)
		INSERT INTO notices.processing_failures(notice_id, stage, error_type, raw_error)
		SELECT notice_id, $2, $3, $4 FROM eligible
		ON CONFLICT (notice_id, stage) DO UPDATE
		SET error_type=EXCLUDED.error_type, raw_error=EXCLUDED.raw_error, failed_at=now()`,
		[
			noticeId,
			"classification",
			error.name,
			[error.stack ?? error.message, "rawResponse" in error ? error.rawResponse : undefined]
				.filter(Boolean)
				.join("\n"),
		],
	);
}

export async function recordNoticeProcessingFailure(
	database: Pick<Pool, "query">,
	noticeId: number,
	stage: NoticeProcessingStage,
	error: Error,
): Promise<void> {
	await database.query(
		`INSERT INTO notices.processing_failures(notice_id, stage, error_type, raw_error)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (notice_id, stage) DO UPDATE
		 SET error_type=EXCLUDED.error_type, raw_error=EXCLUDED.raw_error, failed_at=now()`,
		[
			noticeId,
			stage,
			error.name,
			[error.stack ?? error.message, "rawResponse" in error ? error.rawResponse : undefined]
				.filter(Boolean)
				.join("\n"),
		],
	);
}

export async function withNoticeProcessingLock<T>(
	client: PoolClient,
	stage: NoticeProcessingStage,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T | { outcome: "skipped"; reason: "already-running" }> {
	const controller = new AbortController();
	const onError = (error: Error) => controller.abort(error);
	client.on("error", onError);
	let acquired = false;
	try {
		const result = await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [
			`notice-processing:${stage}`,
		]);
		acquired = result.rows[0]?.acquired === true;
		if (!acquired) {
			return { outcome: "skipped", reason: "already-running" };
		}
		const value = await run(controller.signal);
		controller.signal.throwIfAborted();
		return value;
	} finally {
		try {
			if (acquired && !controller.signal.aborted) {
				await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
					`notice-processing:${stage}`,
				]);
			}
		} finally {
			client.off("error", onError);
		}
	}
}
