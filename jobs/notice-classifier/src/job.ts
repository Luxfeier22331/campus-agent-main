import type { NoticeLabel } from "campus-contracts/notices";
import type { Pool } from "pg";
import { recordNoticeProcessingFailure, recordAutomaticClassificationFailure } from "@campus-agent/notice-database";
import { classifyNoticeByLane } from "notice-classifier-core/lanes";
import type { NoticeModelInput } from "notice-classifier-core/model";
import { NoticeClassificationInvalidOutputError } from "./classifier.ts";

import { classifyNotice, type NoticeModelClassifier } from "./classifier.ts";
import { mapWithConcurrency } from "./concurrency.ts";

export const DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY = 8;

/**
 * `missing` 只处理还没有标签的内部通知；`all` 覆盖全部内部通知，换后端或升判定文本版本后由运维发起；
 * 显式 ID 覆盖指定通知。
 */
export type NoticeClassificationScope = "missing" | "all" | { noticeIds: readonly number[] };

export interface NoticeClassificationJobOptions {
	concurrency?: number;
	signal?: AbortSignal;
	/** 只在有通知未被规则车道命中时调用一次。 */
	createModelClassifier: () => NoticeModelClassifier;
	database: Pick<Pool, "query">;
	scope?: NoticeClassificationScope;
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

export interface NoticeClassificationInput extends NoticeModelInput {
	noticeId: number;
	noticeType: number;
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
	const concurrency = options.concurrency ?? DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY;
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new Error("classification concurrency must be a positive integer");
	}
	const scope = options.scope ?? "missing";
	const inputs = await loadInputs(options.database, scope);
	if (inputs.length === 0) {
		emitProgress(options, { phase: "finalizing", processed: 0, total: 0 });
		return { classified: 0, failed: 0, outcome: "success", requested: 0, skipped: 0 };
	}

	let modelClassifier: NoticeModelClassifier | undefined;
	const classifyWithModel: NoticeModelClassifier = (input) => {
		modelClassifier ??= options.createModelClassifier();
		return modelClassifier(input);
	};
	let classified = 0;
	let failed = 0;
	let skipped = 0;
	let processed = 0;
	emitProgress(options, { phase: "processing", processed: 0, total: inputs.length });
	try {
		await mapWithConcurrency(inputs, concurrency, async (input) => {
			options.signal?.throwIfAborted();
			let label: NoticeLabel;
			try {
				label =
					classifyNoticeByLane(input.noticeType, input.noticeTitle) ??
					(await classifyNotice(input, classifyWithModel));
			} catch (error) {
				const cause = error instanceof Error ? error.cause : undefined;
				if (!(cause instanceof NoticeClassificationInvalidOutputError)) {
					throw new NoticeClassificationJobError(
						`notice ${input.noticeId} model classification failed: ${classificationErrorMessage(error)}`,
						{ cause: error, noticeId: input.noticeId },
					);
				}
				options.signal?.throwIfAborted();
				if (scope === "missing") {
					await recordAutomaticClassificationFailure(options.database, input.noticeId, cause);
				} else {
					await recordNoticeProcessingFailure(options.database, input.noticeId, "classification", cause);
				}
				failed += 1;
				processed += 1;
				emitProgress(options, { phase: "processing", processed, total: inputs.length });
				return;
			}
			options.signal?.throwIfAborted();
			const updated = await options.database.query(
				`WITH updated AS (UPDATE notices.notices SET label_category=$2, label_intent=$3
                     WHERE notice_id=$1 AND title=$4${scope === "missing" ? " AND label_category IS NULL" : ""} RETURNING notice_id),
                 cleared AS (DELETE FROM notices.processing_failures WHERE stage='classification' AND notice_id IN (SELECT notice_id FROM updated))
                 SELECT notice_id FROM updated`,
				[input.noticeId, label.category, label.intent, input.noticeTitle],
			);
			if (updated.rowCount === 1) {
				classified += 1;
			} else if (typeof scope === "object") {
				throw new Error(`notice disappeared or its title changed during classification: ${input.noticeId}`);
			} else {
				skipped += 1;
			}
			processed += 1;
			emitProgress(options, { phase: "writing", processed, total: inputs.length });
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

const INPUT_COLUMNS = `SELECT n.notice_id::text, n.notice_type, t.name AS notice_type_name, n.title, n.is_external
				 FROM notices.notices n JOIN notices.notice_types t USING (notice_type)`;

async function loadInputs(
	database: Pick<Pool, "query">,
	scope: NoticeClassificationScope,
): Promise<NoticeClassificationInput[]> {
	const result =
		typeof scope === "object"
			? await database.query(
					`${INPUT_COLUMNS}
				 WHERE n.notice_id = ANY($1::bigint[])
				 ORDER BY n.notice_id`,
					[[...scope.noticeIds]],
				)
			: scope === "all"
				? await database.query(
						`${INPUT_COLUMNS}
				 WHERE NOT n.is_external
				 ORDER BY n.notice_id`,
					)
				: await database.query(
						`${INPUT_COLUMNS}
				 WHERE NOT n.is_external AND n.label_category IS NULL AND NOT EXISTS (
                     SELECT 1 FROM notices.processing_failures f WHERE f.notice_id=n.notice_id AND f.stage='classification'
                 )
				 ORDER BY n.notice_id`,
					);
	const inputs = result.rows.map((row) => {
		const noticeId = Number(row.notice_id);
		if (row.is_external === true) {
			throw new Error(`external notices are not classified: ${noticeId}`);
		}
		return {
			noticeId,
			noticeTitle: String(row.title),
			noticeType: Number(row.notice_type),
			noticeTypeName: String(row.notice_type_name),
		};
	});
	if (typeof scope === "object") {
		const found = new Set(inputs.map((input) => input.noticeId));
		for (const noticeId of scope.noticeIds) {
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
