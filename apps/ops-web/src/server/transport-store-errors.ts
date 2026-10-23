export class TransportStoreUnavailableError extends Error {
	constructor(message = "班车管理数据库暂不可用。", options?: ErrorOptions) {
		super(message, options);
		this.name = "TransportStoreUnavailableError";
	}
}

export class TransportStoreNotFoundError extends Error {
	constructor(message = "班车记录不存在。") {
		super(message);
		this.name = "TransportStoreNotFoundError";
	}
}

export class TransportStoreConflictError extends Error {
	readonly details: Record<string, unknown> | undefined;

	constructor(message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "TransportStoreConflictError";
		this.details = details;
	}
}

export class TransportStoreValidationError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "TransportStoreValidationError";
	}
}

export async function withTransportStoreErrors<T>(callback: () => Promise<T>): Promise<T> {
	try {
		return await callback();
	} catch (error) {
		if (
			error instanceof TransportStoreConflictError ||
			error instanceof TransportStoreNotFoundError ||
			error instanceof TransportStoreUnavailableError ||
			error instanceof TransportStoreValidationError
		) {
			throw error;
		}
		throw new TransportStoreUnavailableError(undefined, { cause: error });
	}
}
