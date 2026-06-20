export type OtelIngestGatewayHandler = (request: Request) => Promise<Response>;

const ALLOWED_PATHS = new Set(["/v1/traces", "/v1/logs"]);
const ALLOWED_CONTENT_TYPES = [
	"application/json",
	"application/x-protobuf",
	"application/octet-stream",
];
const FORWARDED_HEADERS = ["content-type", "traceparent", "tracestate", "baggage"] as const;

export function createOtelIngestGatewayHandler(input: {
	collectorHttpEndpoint: string;
	fetchImplementation?: typeof fetch;
	maxBodyBytes: number;
	sharedSecret: string;
}): OtelIngestGatewayHandler {
	const fetchImplementation = input.fetchImplementation ?? fetch;
	const collectorHttpEndpoint = input.collectorHttpEndpoint.replace(/\/+$/u, "");

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);

		if (url.pathname === "/healthz" && request.method === "GET") {
			return jsonResponse({ status: "ok" });
		}
		if (url.pathname === "/readyz" && request.method === "GET") {
			return jsonResponse({ status: "ready" });
		}

		if (!ALLOWED_PATHS.has(url.pathname)) {
			return jsonResponse({ error: "not_found" }, 404);
		}
		if (request.method !== "POST") {
			return jsonResponse({ error: "method_not_allowed" }, 405);
		}
		if (!hasBearerToken(request, input.sharedSecret)) {
			return jsonResponse({ error: "unauthorized" }, 401);
		}

		const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
		if (!ALLOWED_CONTENT_TYPES.some((allowed) => contentType.startsWith(allowed))) {
			return jsonResponse({ error: "unsupported_media_type" }, 415);
		}

		const body = await request.arrayBuffer();
		if (body.byteLength > input.maxBodyBytes) {
			return jsonResponse({ error: "payload_too_large" }, 413);
		}

		const headers = new Headers();
		for (const name of FORWARDED_HEADERS) {
			const value = request.headers.get(name);
			if (value) {
				headers.set(name, value);
			}
		}

		const collectorResponse = await fetchImplementation(`${collectorHttpEndpoint}${url.pathname}`, {
			body,
			headers,
			method: "POST",
		});

		if (!collectorResponse.ok) {
			return jsonResponse({ error: "collector_rejected", status: collectorResponse.status }, 502);
		}

		return jsonResponse({ status: "forwarded" });
	};
}

function hasBearerToken(request: Request, expectedToken: string): boolean {
	const authorization = request.headers.get("authorization") ?? "";
	return authorization === `Bearer ${expectedToken}`;
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status,
	});
}
