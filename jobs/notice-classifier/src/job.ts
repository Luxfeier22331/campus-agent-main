import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import type { Pool } from "pg";
import { recordNoticeProcessingFailure, recordAutomaticClassificationFailure } from "@campus-agent/notice-database";
import { NoticeClassificationInvalidOutputError } from "./classifier.ts";

import { classifyNotice, type NoticeModelClassifier } from "./classifier.ts";
import { mapWithConcurrency } from "./concurrency.ts";

export interface NoticeClassificationJobOptions {
	concurrency?: number;
	signal?: AbortSignal;
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
	failed: number;
	outcome: "success" | "partial";
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
		return { classified: 0, failed: 0, outcome: "success", requested: 0, skipped: 0 };
	}

	const modelClassifier = options.createModelClassifier();
	let classified = 0;
	let failed = 0;
	let skipped = 0;
	let processed = 0;
	emitProgress(options, { phase: "processing", processed: 0, total: inputs.length });
	try {
		await mapWithConcurrency(inputs, concurrency, async (input) => {
			options.signal?.throwIfAborted();
			let category;
			try {
				category = await classifyNotice(input.noticeTitle, modelClassifier);
			} catch (error) {
				const cause = error instanceof Error ? error.cause : undefined;
				if (!(cause instanceof NoticeClassificationInvalidOutputError)) {
					throw new NoticeClassificationJobError(
						`notice ${input.noticeId} model classification failed: ${classificationErrorMessage(error)}`,
						{ cause: error, noticeId: input.noticeId },
					);
				}
				options.signal?.throwIfAborted();
				if (explicit) {
					await recordNoticeProcessingFailure(options.database, input.noticeId, "classification", cause);
				} else {
					await recordAutomaticClassificationFailure(options.database, input.noticeId, cause);
				}
				failed += 1;
				processed += 1;
				emitProgress(options, { phase: "processing", processed, total: inputs.length });
				return;
			}
			options.signal?.throwIfAborted();
			const updated = explicit
				? await options.database.query(
						`WITH updated AS (UPDATE notices.notices SET category=$2 WHERE notice_id=$1 RETURNING notice_id),
                         cleared AS (DELETE FROM notices.processing_failures WHERE stage='classification' AND notice_id IN (SELECT notice_id FROM updated))
                         SELECT notice_id FROM updated`,
						[input.noticeId, category],
					)
				: await options.database.query(
						`WITH updated AS (UPDATE notices.notices SET category=$2 WHERE notice_id=$1 AND category IS NULL RETURNING notice_id),
                         cleared AS (DELETE FROM notices.processing_failures WHERE stage='classification' AND notice_id IN (SELECT notice_id FROM updated))
                         SELECT notice_id FROM updated`,
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
	return { classified, failed, outcome: failed ? "partial" : "success", requested: inputs.length, skipped };
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
				 WHERE category IS NULL AND NOT EXISTS (
                     SELECT 1 FROM notices.processing_failures f WHERE f.notice_id=notices.notices.notice_id AND f.stage='classification'
                 )
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
