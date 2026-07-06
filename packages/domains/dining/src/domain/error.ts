export class DiningDomainError extends Error {
	readonly code: string;
	readonly details: unknown;
	readonly retryable: boolean;
	readonly status: number;

	constructor(input: {
		code: string;
		details?: unknown;
		message: string;
		retryable: boolean;
		status: number;
	}) {
		super(input.message);
		this.name = "DiningDomainError";
		this.code = input.code;
		this.details = input.details ?? null;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}
