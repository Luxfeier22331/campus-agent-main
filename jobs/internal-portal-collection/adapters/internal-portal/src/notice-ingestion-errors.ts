export type NoticeIngestionOperation = "detail" | "item" | "source" | "inventory";

export class NoticeIngestionDataError extends Error {
	readonly noticeId: number;
	readonly operation: NoticeIngestionOperation;

	constructor(input: {
		cause?: unknown;
		message: string;
		noticeId: number;
		operation: NoticeIngestionOperation;
	}) {
		super(input.message, input.cause === undefined ? {} : { cause: input.cause });
		this.name = "NoticeIngestionDataError";
		this.noticeId = input.noticeId;
		this.operation = input.operation;
	}
}

export function isNoticeIngestionDataError(error: unknown): error is NoticeIngestionDataError {
	return error instanceof NoticeIngestionDataError;
}
