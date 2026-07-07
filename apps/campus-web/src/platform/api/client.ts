export class UnauthorizedError extends Error {
	constructor(message = "请先登录。") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export async function requestJson<T>(input: {
	body?: BodyInit | null;
	headers?: HeadersInit;
	method?: string;
	path: string;
}): Promise<T> {
	const response = await fetch(input.path, {
		body: input.body,
		credentials: "same-origin",
		headers: {
			accept: "application/json",
			...(input.headers ?? {}),
		},
		method: input.method ?? "GET",
	});

	const contentType = response.headers.get("content-type") ?? "";
	const isJson = contentType.toLowerCase().includes("application/json");
	const payload = response.status === 204 ? undefined : isJson ? await response.json() : undefined;

	if (response.status === 401) {
		throw new UnauthorizedError(parseErrorMessage(payload, response.statusText));
	}

	if (!response.ok) {
		throw new Error(parseErrorMessage(payload, response.statusText));
	}

	if (response.status !== 204 && !isJson) {
		throw new Error("App API returned a non-JSON response.");
	}

	return payload as T;
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
