const DEFAULT_CHAT_STREAM_ERROR_MESSAGE = "请求失败，请稍后重试。";

export class ChatStreamRequestError extends Error {
	code: string;
	requestId: string | undefined;
	retryable: boolean;
	status: number | undefined;

	constructor(input: {
		code: string;
		message: string;
		requestId?: string | undefined;
		retryable: boolean;
		status?: number;
	}) {
		super(input.message);
		this.name = "ChatStreamRequestError";
		this.code = input.code;
		this.requestId = input.requestId;
		this.retryable = input.retryable;
		this.status = input.status;
	}
}

export function invalidProductStreamEvent(): ChatStreamRequestError {
	return new ChatStreamRequestError({
		code: "invalid_stream_event",
		message: "回答连接返回了无效事件。",
		retryable: false,
	});
}

export function invalidRunStatusResponse(status: number): ChatStreamRequestError {
	return new ChatStreamRequestError({
		code: "invalid_request_status_response",
		message: "回答状态返回了无效数据。",
		retryable: false,
		status,
	});
}

export async function createChatStreamRequestError(
	response: Response,
): Promise<ChatStreamRequestError> {
	const payload = await readJsonErrorPayload(response);
	const errorPayload =
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object"
			? payload.error
			: null;
	const message =
		readStringField(errorPayload, "message") ||
		response.statusText ||
		DEFAULT_CHAT_STREAM_ERROR_MESSAGE;
	return new ChatStreamRequestError({
		code: readStringField(errorPayload, "code") ?? "chat_stream_request_failed",
		message,
		...(readStringField(errorPayload, "requestId")
			? { requestId: readStringField(errorPayload, "requestId") }
			: {}),
		retryable: readBooleanField(errorPayload, "retryable") ?? response.status >= 500,
		status: response.status,
	});
}

async function readJsonErrorPayload(response: Response): Promise<unknown> {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		return null;
	}
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function readStringField(input: object | null, field: string): string | undefined {
	if (!(input && field in input)) {
		return;
	}
	const value = (input as Record<string, unknown>)[field];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function readBooleanField(input: object | null, field: string): boolean | undefined {
	if (!(input && field in input)) {
		return;
	}
	const value = (input as Record<string, unknown>)[field];
	return typeof value === "boolean" ? value : undefined;
}
