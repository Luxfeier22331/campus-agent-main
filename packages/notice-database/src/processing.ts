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
			WHERE notice_id=$1 AND label_category IS NULL FOR UPDATE
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

export interface NoticeLockSkipped {
	outcome: "skipped";
	reason: "already-running";
}

// Collection, source migration and state-version maintenance share this key.
const NOTICE_MAINTENANCE_LOCK_KEY = [1_315_928_137, 1] as const;

export async function withNoticeProcessingLock<T>(
	client: PoolClient,
	stage: NoticeProcessingStage,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T | NoticeLockSkipped> {
	return await withSessionAdvisoryLock(
		client,
		{
			acquire: "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
			release: "SELECT pg_advisory_unlock(hashtext($1))",
			params: [`notice-processing:${stage}`],
		},
		run,
	);
}

export async function withNoticeMaintenanceLock<T>(
	client: PoolClient,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T | NoticeLockSkipped> {
	return await withSessionAdvisoryLock(
		client,
		{
			acquire: "SELECT pg_try_advisory_lock($1, $2) AS acquired",
			release: "SELECT pg_advisory_unlock($1, $2)",
			params: [...NOTICE_MAINTENANCE_LOCK_KEY],
		},
		run,
	);
}

export function isNoticeLockSkipped(value: unknown): value is NoticeLockSkipped {
	const record = value as Partial<NoticeLockSkipped> | null;
	return (
		typeof record === "object" &&
		record !== null &&
		record.outcome === "skipped" &&
		record.reason === "already-running"
	);
}

// The lock lives in the session: losing the connection releases it, so the work is aborted.
async function withSessionAdvisoryLock<T>(
	client: PoolClient,
	lock: { acquire: string; release: string; params: unknown[] },
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T | NoticeLockSkipped> {
	const controller = new AbortController();
	const onError = (error: Error) => controller.abort(error);
	client.on("error", onError);
	try {
		const result = await client.query(lock.acquire, lock.params);
		if (result.rows[0]?.acquired !== true) {
			return { outcome: "skipped", reason: "already-running" };
		}
		let value: T;
		try {
			value = await run(controller.signal);
			controller.signal.throwIfAborted();
		} catch (error) {
			// Keep the operation failure; the caller drops the connection, which ends the session lock.
			if (!controller.signal.aborted) {
				await client.query(lock.release, lock.params).catch(() => undefined);
			}
			throw error;
		}
		await client.query(lock.release, lock.params);
		return value;
	} finally {
		client.off("error", onError);
	}
}
