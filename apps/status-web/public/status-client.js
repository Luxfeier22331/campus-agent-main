const STATUS_SNAPSHOT_SCHEMA_VERSION = "product-availability-snapshot.v1";
const STATUS_SERVICES = Object.freeze([
	Object.freeze({ id: "campus.qa", name: "校园问答" }),
	Object.freeze({ id: "campus.services", name: "其他服务" }),
]);

export const STATUS_REQUEST_TIMEOUT_MS = 10_000;

/**
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} fetchFn
 * @param {{ etag?: string | null, timeoutMs?: number }} options
 * @returns {Promise<{ kind: "empty", etag: null } | { kind: "not-modified", etag: string | null } | { kind: "snapshot", etag: string | null, snapshot: Record<string, unknown> }>}
 */
export async function fetchStatusSnapshot(
	fetchFn = (...args) => globalThis.fetch(...args),
	{ etag = null, timeoutMs = STATUS_REQUEST_TIMEOUT_MS } = {},
) {
	const controller = new AbortController();
	let timeoutId;
	const timeout = new Promise((_, reject) => {
		timeoutId = setTimeout(() => {
			controller.abort();
			reject(new Error("status request timed out"));
		}, timeoutMs);
	});
	try {
		const headers = new Headers({ accept: "application/json" });
		if (etag) {
			headers.set("if-none-match", etag);
		}
		const response = await Promise.race([
			Promise.resolve().then(() =>
				fetchFn("/api/status", {
					cache: "no-cache",
					headers,
					signal: controller.signal,
				}),
			),
			timeout,
		]);
		if (response.status === 304) {
			return { etag: response.headers.get("etag") ?? etag, kind: "not-modified" };
		}
		if (response.status === 204) {
			return { etag: null, kind: "empty" };
		}
		if (!response.ok) {
			throw new Error("status unavailable");
		}
		const snapshot = await Promise.race([response.json(), timeout]);
		if (
			!snapshot ||
			typeof snapshot !== "object" ||
			snapshot.schemaVersion !== STATUS_SNAPSHOT_SCHEMA_VERSION ||
			!Array.isArray(snapshot.services) ||
			snapshot.services.length !== STATUS_SERVICES.length ||
			!STATUS_SERVICES.every(
				(expected, index) =>
					snapshot.services[index]?.id === expected.id &&
					snapshot.services[index]?.name === expected.name,
			)
		) {
			throw new Error("invalid status snapshot");
		}
		return { etag: response.headers.get("etag") ?? etag, kind: "snapshot", snapshot };
	} finally {
		clearTimeout(timeoutId);
	}
}
