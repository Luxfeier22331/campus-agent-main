export async function readJsonResponse(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export async function expectJsonResponse<T>(
	response: Response,
	expectedStatus: number,
): Promise<T> {
	const payload = await readJsonResponse(response);
	if (response.status !== expectedStatus) {
		throw new Error(
			`Expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(payload)}`,
		);
	}

	return payload as T;
}

function splitSetCookieHeader(value: string): string[] {
	return value
		.split(/,(?=\s*[^;,=\s]+=[^;]+)/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function buildCookieHeader(response: Response): string {
	const headersWithGetSetCookie = response.headers as Headers & {
		getSetCookie?: () => string[];
	};
	const setCookies =
		typeof headersWithGetSetCookie.getSetCookie === "function"
			? headersWithGetSetCookie.getSetCookie()
			: splitSetCookieHeader(response.headers.get("set-cookie") ?? "");

	if (setCookies.length === 0) {
		throw new Error("Expected auth response to include a session cookie.");
	}

	return setCookies
		.map((cookie) => cookie.split(";", 1)[0])
		.filter((cookie): cookie is string => typeof cookie === "string" && cookie.length > 0)
		.join("; ");
}
