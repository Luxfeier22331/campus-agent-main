export class OfficialWebControlPlaneError extends Error {
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
		this.name = "OfficialWebControlPlaneError";
		this.code = input.code;
		this.details = input.details ?? null;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export function officialWebErrorEnvelope(error: OfficialWebControlPlaneError) {
	return {
		error: {
			code: error.code,
			details: error.details,
			message: error.message,
			requestId: null,
			retryable: error.retryable,
			traceId: null,
		},
	};
}
