import { classifyNotice, type NoticeCategory, type NoticeModelClassifier } from "./classifier.ts";
import { mapWithConcurrency } from "./concurrency.ts";

export const DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY = 2;

export interface NoticeClassificationTask {
	noticeId: number;
	noticeTitle: string;
}

export interface NoticeClassificationResult {
	notice_id: number;
	category: NoticeCategory;
}

export async function classifyNoticeBatch(
	inputs: readonly NoticeClassificationTask[],
	createModelClassifier: () => NoticeModelClassifier,
	concurrency = DEFAULT_NOTICE_CLASSIFICATION_CONCURRENCY,
): Promise<NoticeClassificationResult[]> {
	assertConcurrency(concurrency);
	let modelClassifier: NoticeModelClassifier | undefined;
	const classifyWithModel: NoticeModelClassifier = async (noticeTitle) => {
		modelClassifier ??= createModelClassifier();
		return modelClassifier(noticeTitle);
	};
	const results = await mapWithConcurrency(inputs, concurrency, async (input) => {
		try {
			return {
				notice_id: input.noticeId,
				category: await classifyNotice(input.noticeTitle, classifyWithModel),
			};
		} catch (error) {
			throw new Error(
				`notice ${input.noticeId} model classification failed: ${classificationErrorMessage(error)}`,
				{ cause: error },
			);
		}
	});
	results.sort((left, right) => left.notice_id - right.notice_id);
	assertCompleteNoticeClassificationResults(inputs, results);
	return results;
}

export function assertCompleteNoticeClassificationResults(
	inputs: readonly NoticeClassificationTask[],
	results: readonly NoticeClassificationResult[],
): void {
	if (inputs.length !== results.length) {
		throw new Error(
			`classification result count mismatch: expected ${inputs.length}, received ${results.length}`,
		);
	}
	const expectedIds = inputs.map((input) => input.noticeId).sort((left, right) => left - right);
	if (new Set(expectedIds).size !== expectedIds.length) {
		throw new Error("classification inputs contain duplicate notice ids");
	}
	const actualIds = results.map((result) => result.notice_id).sort((left, right) => left - right);
	if (expectedIds.some((noticeId, index) => actualIds[index] !== noticeId)) {
		throw new Error("classification results do not cover the input notice ids exactly");
	}
}

function assertConcurrency(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error("classification concurrency must be a positive integer");
	}
}

function classificationErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const prefix = "model classification failed: ";
	return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}
