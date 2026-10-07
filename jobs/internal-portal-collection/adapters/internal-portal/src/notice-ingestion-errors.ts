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

// The portal answers `state:false` with a fixed deletion/permission message when a
// notice no longer exists for this account. That is a deterministic business
// conclusion, distinct from transient fetch failures that should be retried.
export class PortalNoticeUnavailableError extends Error {
	readonly noticeId: number;

	constructor(input: { message: string; noticeId: number }) {
		super(input.message);
		this.name = "PortalNoticeUnavailableError";
		this.noticeId = input.noticeId;
	}
}
