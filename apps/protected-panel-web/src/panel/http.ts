import { HttpError } from "react-admin";

import { translateRuntimeErrorMessage } from "./panel-copy";

interface HttpRequestOptions {
	method?: string;
	signal?: AbortSignal;
}

type RedirectingHttpError = HttpError & {
	redirectTo?: string;
};

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

function createAccessReentryRequiredError(): RedirectingHttpError {
	const error = new HttpError("当前受保护访问会话已失效，请重新进入面板。", 401, {
		error: {
			code: "access_reentry_required",
			message: "当前受保护访问会话已失效，请重新进入面板。",
		},
	}) as RedirectingHttpError;

	error.redirectTo = "/login";
	return error;
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
	const response = await fetch(path, {
		credentials: "same-origin",
		headers: {
			accept: "application/json",
		},
		method: options.method ?? "GET",
		redirect: "manual",
		signal: options.signal,
	});

	const contentType = response.headers.get("content-type") ?? "";
	if (isCloudflareAccessLoginResponse(response, contentType)) {
		throw createAccessReentryRequiredError();
	}

	if (response.ok && !contentType.includes("application/json")) {
		throw new HttpError("面板运行时返回了非 JSON 的成功响应。", 502, {
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
				throw new HttpError("面板运行时返回了无效的 JSON。", 502, {
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
		throw new HttpError(parseMessage(payload, response.statusText), response.status, payload);
	}

	return payload as T;
}
