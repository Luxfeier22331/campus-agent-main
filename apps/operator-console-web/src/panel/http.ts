import { translateRuntimeErrorMessage } from "./panel-copy";
import { PanelHttpError } from "./panel-error";

interface HttpRequestOptions {
	json?: unknown;
	method?: string;
	signal?: AbortSignal;
}

function parseMessage(payload: unknown, statusText: string): string {
	if (
		payload &&
		typeof payload === "object" &&
		"error" in payload &&
		payload.error &&
		typeof payload.error === "object" &&
		"code" in payload.error &&
		(typeof payload.error.code === "string" || payload.error.code === null) &&
		"message" in payload.error &&
		typeof payload.error.message === "string"
	) {
		return translateRuntimeErrorMessage({
			code: payload.error.code,
			message: payload.error.message,
			statusText,
		});
	}

	if (typeof payload === "string" && payload.trim()) {
		return payload;
	}

	return statusText || "请求失败。";
}

function createAccessReentryRequiredError(): PanelHttpError {
	return new PanelHttpError(
		"当前受保护访问会话已失效，请重新进入面板。",
		401,
		{
			error: {
				code: "access_reentry_required",
				message: "当前受保护访问会话已失效，请重新进入面板。",
			},
		},
		"/login",
	);
}

function isCloudflareAccessLoginResponse(response: Response, contentType: string): boolean {
	return (
		response.type === "opaqueredirect" ||
		Boolean(response.headers.get("cf-access-domain")) ||
		response.url.includes("/cdn-cgi/access/login/") ||
		(contentType.includes("text/html") && response.redirected)
	);
}

export async function fetchJson<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
	const headers: Record<string, string> = {
		accept: "application/json",
	};
	const body = options.json === undefined ? undefined : JSON.stringify(options.json);
	if (body !== undefined) {
		headers["content-type"] = "application/json";
	}

	const response = await fetch(path, {
		body,
		credentials: "same-origin",
		headers,
		method: options.method ?? "GET",
		redirect: "manual",
		signal: options.signal,
	});

	const contentType = response.headers.get("content-type") ?? "";
	if (isCloudflareAccessLoginResponse(response, contentType)) {
		throw createAccessReentryRequiredError();
	}

	if (response.ok && !contentType.includes("application/json")) {
		throw new PanelHttpError("面板运行时返回了非 JSON 的成功响应。", 502, {
			error: {
				code: "invalid_runtime_payload",
				details: {
					contentType,
					url: response.url,
				},
				message: "面板运行时返回了非 JSON 的成功响应。",
			},
		});
	}

	const payload = contentType.includes("application/json")
		? await response.json().catch(() => {
				throw new PanelHttpError("面板运行时返回了无效的 JSON。", 502, {
					error: {
						code: "invalid_runtime_payload",
						details: {
							contentType,
							url: response.url,
						},
						message: "面板运行时返回了无效的 JSON。",
					},
				});
			})
		: await response.text();

	if (!response.ok) {
		throw new PanelHttpError(parseMessage(payload, response.statusText), response.status, payload);
	}

	return payload as T;
}
