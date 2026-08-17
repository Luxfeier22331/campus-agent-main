export class DiningStoreUnavailableError extends Error {
	readonly code = "OPS_DINING_STORE_UNAVAILABLE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DiningStoreUnavailableError";
	}
}

export class DiningStoreNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiningStoreNotFoundError";
	}
}

export class DiningStoreConflictError extends Error {
	readonly details: Record<string, unknown> | undefined;

	constructor(message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "DiningStoreConflictError";
		this.details = details;
	}
}

export class DiningStoreValidationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DiningStoreValidationError";
	}
}
