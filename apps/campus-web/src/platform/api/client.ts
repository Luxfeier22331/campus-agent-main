export class ApiRequestError extends Error {
	readonly code: string | null;
	readonly retryable: boolean | null;
	readonly status: number;

	constructor(input: {
		code?: string | null;
		message: string;
		retryable?: boolean | null;
		status: number;
	}) {
		super(input.message);
		this.name = "ApiRequestError";
		this.code = input.code ?? null;
		this.retryable = input.retryable ?? null;
		this.status = input.status;
	}
}

export class UnauthorizedError extends ApiRequestError {
	constructor(message = "请先登录。") {
		super({ message, status: 401, retryable: false });
		this.name = "UnauthorizedError";
	}
}

export async function requestJson<T>(input: {
	body?: BodyInit | null;
	headers?: HeadersInit;
	method?: string;
	path: string;
	signal?: AbortSignal;
}): Promise<T> {
	const response = await fetch(input.path, {
		...(input.body === undefined ? {} : { body: input.body }),
		credentials: "same-origin",
		headers: {
			accept: "application/json",
			...(input.headers ?? {}),
		},
		method: input.method ?? "GET",
		...(input.signal ? { signal: input.signal } : {}),
	});

	const contentType = response.headers.get("content-type") ?? "";
	const isJson = contentType.toLowerCase().includes("application/json");
	const payload = response.status === 204 ? undefined : isJson ? await response.json() : undefined;

	if (response.status === 401) {
		throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
	}

	if (!response.ok) {
		throw new ApiRequestError({
			code: parseErrorField(payload, "code"),
			message: parseErrorMessage(payload, response.statusText),
			retryable: parseErrorBoolean(payload, "retryable"),
			status: response.status,
		});
	}

	if (response.status !== 204 && !isJson) {
		throw new Error("App API returned a non-JSON response.");
	}

	return payload as T;
}

function parseErrorField(payload: unknown, field: "code"): string | null {
	if (
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object" &&
		field in payload.error &&
		typeof payload.error[field] === "string"
	) {
		return payload.error[field];
	}
	return null;
}

function parseErrorBoolean(payload: unknown, field: "retryable"): boolean | null {
	if (
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object" &&
		field in payload.error &&
		typeof payload.error[field] === "boolean"
	) {
		return payload.error[field];
	}
	return null;
}

export function parseErrorMessage(payload: unknown, statusText: string): string {
	if (
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object" &&
		"message" in payload.error &&
		typeof payload.error.message === "string"
	) {
		return payload.error.message;
	}
	return statusText || "请求失败。";
}

export function createIdempotencyKey(): string {
	return crypto.randomUUID();
}
