import {
	readNoticeClassificationArtifact,
	writeNoticeClassificationArtifact,
} from "./artifacts.ts";
import {
	classifyNotice,
	type NoticeModelClassifier,
} from "./classifier.ts";
import type { NoticeClassificationTask } from "notice-classifier-core/batch";
import { mapWithConcurrency } from "./concurrency.ts";
import type { NoticeClassifierObjectStore } from "./object-store.ts";
import { loadNoticeClassificationInputs } from "./source.ts";

export interface NoticeClassificationJobOptions {
	concurrency?: number;
	createModelClassifier: () => NoticeModelClassifier;
	noticeIds?: readonly number[];
	objectStore: NoticeClassifierObjectStore;
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
	const explicitNoticeIds = options.noticeIds !== undefined;
	const inputs = await loadNoticeClassificationInputs(options.objectStore, options.noticeIds, {
		concurrency,
	});
	const pending = explicitNoticeIds
		? inputs
		: await selectMissingArtifacts(inputs, options.objectStore, concurrency);
	if (pending.length === 0) {
		return { classified: 0, requested: inputs.length, skipped: inputs.length };
	}

	const modelClassifier = options.createModelClassifier();
	let classified = 0;
	try {
		await mapWithConcurrency(pending, concurrency, async (input) => {
			const category = await classifyNotice(input.noticeTitle, modelClassifier).catch((error) => {
				throw new NoticeClassificationJobError(
					`notice ${input.noticeId} model classification failed: ${classificationErrorMessage(error)}`,
					{ cause: error, noticeId: input.noticeId },
				);
			});
			await writeNoticeClassificationArtifact(options.objectStore, {
				category,
				noticeId: input.noticeId,
			});
			classified += 1;
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
	return {
		classified,
		requested: inputs.length,
		skipped: inputs.length - pending.length,
	};
}

async function selectMissingArtifacts(
	inputs: readonly NoticeClassificationTask[],
	objectStore: Pick<NoticeClassifierObjectStore, "getDerived">,
	concurrency: number,
): Promise<NoticeClassificationTask[]> {
	const states = await mapWithConcurrency(inputs, concurrency, async (input) => ({
		input,
		valid: (await readNoticeClassificationArtifact(objectStore, input.noticeId)) !== null,
	}));
	return states.filter((state) => !state.valid).map((state) => state.input);
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
