import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import type { Pool } from "pg";

import { classifyNotice, type NoticeModelClassifier } from "./classifier.ts";
import { mapWithConcurrency } from "./concurrency.ts";

export interface NoticeClassificationJobOptions {
	concurrency?: number;
	createModelClassifier: () => NoticeModelClassifier;
	database: Pick<Pool, "query">;
	noticeIds?: readonly number[];
	onProgress?: (progress: NoticeClassificationProgress) => void;
}

export interface NoticeClassificationProgress {
	phase: "processing" | "writing" | "finalizing";
	processed: number;
	total: number;
}

export interface NoticeClassificationJobResult {
	classified: number;
	requested: number;
	skipped: number;
}

export class NoticeClassificationJobError extends Error {
	readonly noticeId: number | null;

	constructor(message: string, options: { cause?: unknown; noticeId?: number | null } = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "NoticeClassificationJobError";
		this.noticeId = options.noticeId ?? null;
	}
}

export async function runNoticeClassificationJob(
	options: NoticeClassificationJobOptions,
): Promise<NoticeClassificationJobResult> {
	const concurrency = options.concurrency ?? 2;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new Error("classification concurrency must be a positive integer");
	}
	const explicit = options.noticeIds !== undefined;
	const inputs = await loadInputs(options.database, options.noticeIds);
	if (inputs.length === 0) {
		emitProgress(options, { phase: "finalizing", processed: 0, total: 0 });
		return { classified: 0, requested: 0, skipped: 0 };
	}

	const modelClassifier = options.createModelClassifier();
	let classified = 0;
	let skipped = 0;
	let processed = 0;
	emitProgress(options, { phase: "processing", processed: 0, total: inputs.length });
	try {
		await mapWithConcurrency(inputs, concurrency, async (input) => {
			const category = await classifyNotice(input.noticeTitle, modelClassifier).catch((error) => {
				throw new NoticeClassificationJobError(
					`notice ${input.noticeId} model classification failed: ${classificationErrorMessage(error)}`,
					{ cause: error, noticeId: input.noticeId },
				);
			});
			const updated = explicit
				? await options.database.query(
						"UPDATE notices.notices SET category=$2 WHERE notice_id=$1",
						[input.noticeId, category],
					)
				: await options.database.query(
						"UPDATE notices.notices SET category=$2 WHERE notice_id=$1 AND category IS NULL",
						[input.noticeId, category],
					);
			if (updated.rowCount === 1) {
				classified += 1;
			} else if (explicit) {
				throw new Error(`notice does not exist: ${input.noticeId}`);
			} else {
				skipped += 1;
			}
			processed += 1;
			emitProgress(options, { phase: "writing", processed, total: inputs.length });
			return category;
		});
	} catch (error) {
		if (error instanceof NoticeClassificationJobError) {
			throw error;
		}
		throw new NoticeClassificationJobError(
			`notice classification job failed${noticeIdFromError(error) ? ` for notice ${noticeIdFromError(error)}` : ""}`,
			{ cause: error, noticeId: noticeIdFromError(error) },
		);
	}
	emitProgress(options, { phase: "finalizing", processed, total: inputs.length });
	return { classified, requested: inputs.length, skipped };
}

function emitProgress(
	options: NoticeClassificationJobOptions,
	progress: NoticeClassificationProgress,
): void {
	options.onProgress?.(progress);
}

async function loadInputs(
	database: Pick<Pool, "query">,
	noticeIds?: readonly number[],
): Promise<NoticeClassificationTask[]> {
	const explicit = noticeIds !== undefined;
	const result = explicit
		? await database.query(
				`SELECT notice_id::text, title
				 FROM notices.notices
				 WHERE notice_id = ANY($1::bigint[])
				 ORDER BY notice_id`,
				[[...noticeIds]],
			)
		: await database.query(
				`SELECT notice_id::text, title
				 FROM notices.notices
				 WHERE category IS NULL
				 ORDER BY notice_id`,
			);
	const inputs = result.rows.map((row) => ({
		noticeId: Number(row.notice_id),
		noticeTitle: String(row.title),
	}));
	if (explicit) {
		const found = new Set(inputs.map((input) => input.noticeId));
		for (const noticeId of noticeIds) {
			if (!found.has(noticeId)) {
				throw new Error(`notice does not exist: ${noticeId}`);
			}
		}
	}
	return inputs;
}

function classificationErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const prefix = "model classification failed: ";
	return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function noticeIdFromError(error: unknown): number | null {
	if (error && typeof error === "object" && "noticeId" in error) {
		const value = (error as { noticeId?: unknown }).noticeId;
		return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
	}
	const message = error instanceof Error ? error.message : String(error);
	const match = /notice ([1-9][0-9]*)/u.exec(message);
	return match?.[1] ? Number(match[1]) : null;
}
