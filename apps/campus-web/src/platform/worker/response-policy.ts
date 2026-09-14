export const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https://p.qlogo.cn data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self'; worker-src 'self' blob:",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
	"referrer-policy": "strict-origin-when-cross-origin",
	"x-content-type-options": "nosniff",
} as const;

export function jsonResponse(status: number, payload: Record<string, unknown>): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			"cache-control": "no-store",
			"content-type": "application/json; charset=utf-8",
			...SECURITY_HEADERS,
		},
	});
}

export function responseWithSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

export async function withNoStore(response: Response): Promise<Response> {
	const headers = new Headers(response.headers);
	headers.set("cache-control", "no-store");
	headers.delete("content-encoding");
	headers.delete("content-length");
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}

export function dependencyNotReadyResponse(): Response {
	return jsonResponse(503, {
		error: {
			code: "dependency_not_ready",
			retryable: true,
			requestId: null,
			details: null,
			message: "服务暂不可用，请稍后再试。",
		},
	});
}

export function isHtmlServerErrorResponse(response: Response): boolean {
	if (response.status < 500) {
		return false;
	}
	return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}
