export { NOTICE_CATEGORIES, type NoticeCategory } from "campus-contracts/notices";

import type { NoticeCategory } from "campus-contracts/notices";

export type NoticeModelClassifier = (noticeTitle: string) => Promise<NoticeCategory>;

export const NOTICE_CLASSIFICATION_RETRY_DELAYS_MS = [15_000, 30_000] as const;

interface NoticeClassificationProviderErrorOptions extends ErrorOptions {
	retryable?: boolean;
}

export class NoticeClassificationProviderError extends Error {
	readonly retryable: boolean;

	constructor(message: string, options: NoticeClassificationProviderErrorOptions = {}) {
		const { retryable = true, ...errorOptions } = options;
		super(message, errorOptions);
		this.name = "NoticeClassificationProviderError";
		this.retryable = retryable;
	}
}

export class NoticeClassificationInvalidOutputError extends Error {
	readonly rawResponse: string | undefined;

	constructor(message: string, options: ErrorOptions & { rawResponse?: string } = {}) {
		const { rawResponse, ...errorOptions } = options;
		super(message, errorOptions);
		this.name = "NoticeClassificationInvalidOutputError";
		this.rawResponse = rawResponse;
	}
}

export function isRetryableNoticeClassificationError(error: unknown): boolean {
	return (
		error instanceof NoticeClassificationInvalidOutputError ||
		(error instanceof NoticeClassificationProviderError && error.retryable)
	);
}

export async function classifyNotice(
	noticeTitle: string,
	classifyWithModel: NoticeModelClassifier,
	sleep: (delayMs: number) => Promise<void> = delay,
): Promise<NoticeCategory> {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			return await classifyWithModel(noticeTitle);
		} catch (error) {
			if (isRetryableNoticeClassificationError(error) && attempt < 3) {
				await sleep(NOTICE_CLASSIFICATION_RETRY_DELAYS_MS[attempt - 1] ?? 0);
				continue;
			}
			throw new Error(`model classification failed: ${formatError(error)}`, { cause: error });
		}
	}
	throw new Error("model classification failed");
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function delay(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}
