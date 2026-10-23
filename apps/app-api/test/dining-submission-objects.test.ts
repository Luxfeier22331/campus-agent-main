import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../src/config";
import { createDiningSubmissionObjects } from "../src/modules/dining/submission-objects";

const key = "dining/submissions/submission-id/photo-id.webp";
const bytes = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
const photo = { bytes, width: 1, height: 1 };
const unavailable = {
	code: "dining_submission_storage_unavailable",
	status: 503,
	retryable: true,
};
const credentials = {
	OBJECT_STORE_DERIVED_ACCESS_KEY: "derived-access",
	OBJECT_STORE_DERIVED_SECRET_KEY: "derived-secret",
};

function privateStore(handler: (request: Request) => Promise<Response>) {
	const fetch = vi.fn(handler);
	const binding = { fetch };
	const env: Env = {
		...credentials,
		DEPLOYMENT_ENVIRONMENT: "staging",
		OBJECT_STORE_PRIVATE: binding,
		OBJECT_STORE_LOCAL_BASE_URL: "https://must-not-be-used.invalid/campus-agent-derived/",
	};
	return { fetch, binding, store: createDiningSubmissionObjects(env) };
}

function missing() {
	return new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
}

function xmlResponse(value: string) {
	return new Response(value, { headers: { "content-type": "application/xml" } });
}

function version(versionId: string, objectKey = key, marker = false) {
	const tag = marker ? "DeleteMarker" : "Version";
	return `<${tag}><Key>${objectKey}</Key><VersionId>${versionId}</VersionId></${tag}>`;
}

function listing(
	entries = "",
	next?: { key: string; versionId: string },
	bucket = "campus-agent-derived",
) {
	return `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
		<Name>${bucket}</Name><Prefix>${key}</Prefix>
		<IsTruncated>${next ? "true" : "false"}</IsTruncated>${entries}
		${next ? `<NextKeyMarker>${next.key}</NextKeyMarker><NextVersionIdMarker>${next.versionId}</NextVersionIdMarker>` : ""}
	</ListVersionsResult>`;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("Dining submission objects", () => {
	it("signs private WebP writes with the dedicated identity and returns the stored version", async () => {
		const globalFetch = vi.spyOn(globalThis, "fetch");
		const { store, fetch, binding } = privateStore(async function (this: unknown, request) {
			expect(this).toBe(binding);
			expect(request.method).toBe("PUT");
			expect(request.url).toBe(`http://object-store/campus-agent-derived/${key}`);
			expect(request.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
			expect(request.headers.get("authorization")).toContain("Credential=derived-access/");
			expect(request.headers.get("content-type")).toBe("image/webp");
			expect(request.headers.get("cache-control")).toBe("no-store");
			expect(request.redirect).toBe("manual");
			expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
			return new Response(null, { headers: { "x-amz-version-id": "stored-version" } });
		});
		await expect(store.put(key, photo)).resolves.toEqual({ versionId: "stored-version" });
		expect(fetch).toHaveBeenCalledOnce();
		expect(globalFetch).not.toHaveBeenCalled();
	});

	it.each([null, "null"])("returns null for unversioned write headers (%s)", async (versionId) => {
		const { store } = privateStore(
			async () =>
				new Response(null, { headers: versionId ? { "x-amz-version-id": versionId } : {} }),
		);
		await expect(store.put(key, photo)).resolves.toEqual({ versionId: null });
	});

	it("reads bytes over the configured local tunnel, accepting a per-worktree derived bucket", async () => {
		const bucket = "campus-agent-derived-wt-2-ec666976";
		const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async function (
			this: unknown,
			input,
		) {
			expect(this).toBe(globalThis);
			const request = input as Request;
			expect(request.url).toBe(`http://127.0.0.1:19000/${bucket}/${key}`);
			expect(request.headers.get("authorization")).toContain("Credential=derived-access/");
			return new Response(bytes, { headers: { "content-type": "image/webp" } });
		});
		const store = createDiningSubmissionObjects({
			...credentials,
			DEPLOYMENT_ENVIRONMENT: "development",
			OBJECT_STORE_LOCAL_BASE_URL: `http://127.0.0.1:19000/${bucket}`,
		});
		await expect(store.get(key)).resolves.toEqual(bytes);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each([
		"notices/assets/a",
		"dining/floorplans/a.svg",
		"dining/submissions/../floorplans/a.svg",
		"dining/submissions/%2e%2e/a.webp",
		"dining/submissions/a%2Fb.webp",
		"dining/submissions/a\\b.webp",
		"dining/submissions//a.webp",
		"dining/submissions/a?versionId=other",
		"dining/submissions/a#fragment",
		"dining/submissions/",
		"https://other.invalid/dining/submissions/a.webp",
	])("rejects escaping or unrelated keys before any request (%s)", async (invalidKey) => {
		const { store, fetch } = privateStore(async () => missing());
		await expect(store.get(invalidKey)).rejects.toMatchObject(unavailable);
		await expect(store.put(invalidKey, photo)).rejects.toMatchObject(unavailable);
		await expect(store.deleteAllVersions(invalidKey)).rejects.toMatchObject(unavailable);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([
		{ DEPLOYMENT_ENVIRONMENT: "staging" },
		{ DEPLOYMENT_ENVIRONMENT: "production" },
		{
			DEPLOYMENT_ENVIRONMENT: "development",
			OBJECT_STORE_LOCAL_BASE_URL: "http://127.0.0.1:19000/derived/extra/",
		},
		{
			DEPLOYMENT_ENVIRONMENT: "development",
			OBJECT_STORE_LOCAL_BASE_URL: "http://127.0.0.1:19000/",
		},
		{
			DEPLOYMENT_ENVIRONMENT: "development",
			OBJECT_STORE_LOCAL_BASE_URL: "http://127.0.0.1:19000/Campus_Agent/",
		},
	])("fails closed when the private binding or local bucket path is unavailable", async (env) => {
		const fetch = vi.spyOn(globalThis, "fetch");
		const store = createDiningSubmissionObjects({ ...credentials, ...env });
		await expect(store.get(key)).rejects.toMatchObject(unavailable);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("does not borrow the read-only identity when the derived write identity is missing", async () => {
		const fetch = vi.fn();
		const store = createDiningSubmissionObjects({
			DEPLOYMENT_ENVIRONMENT: "staging",
			OBJECT_STORE_PRIVATE: { fetch },
			OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-access",
			OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret",
		});
		await expect(store.get(key)).rejects.toMatchObject(unavailable);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("distinguishes missing objects and current delete markers from broken storage", async () => {
		const { store, fetch } = privateStore(async () => missing());
		await expect(store.get(key)).resolves.toBeNull();
		fetch.mockResolvedValueOnce(
			new Response(null, { status: 404, headers: { "x-amz-delete-marker": "true" } }),
		);
		await expect(store.get(key)).resolves.toBeNull();
		fetch.mockResolvedValueOnce(
			new Response("<Error><Code>NoSuchBucket</Code></Error>", { status: 404 }),
		);
		await expect(store.get(key)).rejects.toMatchObject(unavailable);
		fetch.mockResolvedValueOnce(new Response("proxy failure", { status: 404 }));
		await expect(store.get(key)).rejects.toMatchObject(unavailable);
	});

	it("enumerates every page, removes exact-key versions and delete markers, then verifies absence", async () => {
		const deleted: string[] = [];
		let page = 0;
		const { store, fetch } = privateStore(async (request) => {
			const url = new URL(request.url);
			expect(request.headers.get("authorization")).toContain("Credential=derived-access/");
			if (url.searchParams.has("versions")) {
				expect(url.pathname).toBe("/campus-agent-derived/");
				expect(url.searchParams.get("prefix")).toBe(key);
				page += 1;
				if (page === 1) {
					return xmlResponse(
						listing(version("v1") + version("m1", key, true), { key, versionId: "m1" }),
					);
				}
				if (page === 2) {
					expect(url.searchParams.get("key-marker")).toBe(key);
					expect(url.searchParams.get("version-id-marker")).toBe("m1");
					return xmlResponse(listing(version("null") + version("neighbor", `${key}.backup`)));
				}
				expect(deleted).toEqual(["v1", "m1", "null"]);
				return xmlResponse(listing());
			}
			if (request.method === "DELETE") {
				expect(url.pathname).toBe(`/campus-agent-derived/${key}`);
				deleted.push(url.searchParams.get("versionId") ?? "bare-delete");
				return new Response(null, { status: 204 });
			}
			expect(request.method).toBe("GET");
			return missing();
		});
		await expect(store.deleteAllVersions(key)).resolves.toBeUndefined();
		expect(deleted).toEqual(["v1", "m1", "null"]);
		expect(fetch).toHaveBeenCalledTimes(7);
	});

	it("deletes an unversioned current object and checks both its current bytes and version listing", async () => {
		let current = true;
		let listRequests = 0;
		const { store, fetch } = privateStore(async (request) => {
			const url = new URL(request.url);
			if (url.searchParams.has("versions")) {
				listRequests += 1;
				return xmlResponse(listing());
			}
			if (request.method === "DELETE") {
				expect(url.search).toBe("");
				current = false;
				return new Response(null, { status: 204 });
			}
			return current ? new Response(bytes) : missing();
		});
		await expect(store.deleteAllVersions(key)).resolves.toBeUndefined();
		expect(listRequests).toBe(2);
		expect(current).toBe(false);
		expect(fetch).toHaveBeenCalledTimes(5);
	});

	it("can resume cleanup after the object has already disappeared", async () => {
		const { store, fetch } = privateStore(async (request) =>
			new URL(request.url).searchParams.has("versions") ? xmlResponse(listing()) : missing(),
		);
		await expect(store.deleteAllVersions(key)).resolves.toBeUndefined();
		expect(fetch.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
	});

	it.each([
		"<ListVersionsResult>",
		"<Error><Code>AccessDenied</Code></Error>",
		listing().replace("<IsTruncated>false</IsTruncated>", ""),
		listing().replace("<IsTruncated>false</IsTruncated>", "<IsTruncated>true</IsTruncated>"),
		listing("", { key, versionId: "unread-page" }).replace(
			"<IsTruncated>true</IsTruncated>",
			"<IsTruncated>false</IsTruncated>",
		),
		listing().replace("campus-agent-derived", "another-bucket"),
		listing("<Version><Key>missing-version-id</Key></Version>"),
		listing(version("wrong-prefix", "dining/floorplans/other")),
		listing(version("duplicated") + version("duplicated")),
		listing().replace(
			"</ListVersionsResult>",
			"<CommonPrefixes><Prefix>hidden</Prefix></CommonPrefixes></ListVersionsResult>",
		),
	])("refuses incomplete or inconsistent version listings before deleting (%#)", async (xml) => {
		const { store, fetch } = privateStore(async () => xmlResponse(xml));
		await expect(store.deleteAllVersions(key)).rejects.toMatchObject(unavailable);
		expect(fetch.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
	});

	it("stops cyclic pagination before deleting anything", async () => {
		const { store, fetch } = privateStore(async () =>
			xmlResponse(listing("", { key, versionId: "cycle" })),
		);
		await expect(store.deleteAllVersions(key)).rejects.toMatchObject(unavailable);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls.every(([request]) => request.method === "GET")).toBe(true);
	});

	it.each(["version-remains", "bytes-remain", "delete-error"])(
		"does not declare partial cleanup complete (%s)",
		async (failure) => {
			let listingCount = 0;
			const { store } = privateStore(async (request) => {
				const url = new URL(request.url);
				if (url.searchParams.has("versions")) {
					listingCount += 1;
					return xmlResponse(
						listing(listingCount === 1 || failure === "version-remains" ? version("v1") : ""),
					);
				}
				if (request.method === "DELETE") {
					return failure === "delete-error"
						? new Response("<Error><Code>AccessDenied</Code></Error>", { status: 200 })
						: new Response(null, { status: 204 });
				}
				return new Response(bytes);
			});
			await expect(store.deleteAllVersions(key)).rejects.toMatchObject(unavailable);
		},
	);

	it("maps transport failures to a stable error without secrets or storage coordinates", async () => {
		const { store } = privateStore(async () => {
			throw new Error(`derived-secret http://object-store/campus-agent-derived/${key}`);
		});
		for (const action of [
			() => store.put(key, photo),
			() => store.get(key),
			() => store.deleteAllVersions(key),
		]) {
			const error = await action().catch((cause: unknown) => cause);
			expect(error).toMatchObject({
				...unavailable,
				message: "Dining photo storage is unavailable.",
				details: null,
			});
			expect(String(error)).not.toContain(key);
			expect(String(error)).not.toContain("derived-secret");
		}
	});

	it.each([301, 403, 500])(
		"fails dependency responses without retrying or following redirects (%s)",
		async (status) => {
			const globalFetch = vi.spyOn(globalThis, "fetch");
			const { store, fetch } = privateStore(
				async () =>
					new Response(null, {
						status,
						headers: { location: "https://public-storage.invalid/" },
					}),
			);
			await expect(store.put(key, photo)).rejects.toMatchObject(unavailable);
			await expect(store.get(key)).rejects.toMatchObject(unavailable);
			await expect(store.deleteAllVersions(key)).rejects.toMatchObject(unavailable);
			expect(fetch).toHaveBeenCalledTimes(3);
			expect(globalFetch).not.toHaveBeenCalled();
		},
	);

	it("rejects truncated object bodies and non-WebP storage responses", async () => {
		const { store, fetch } = privateStore(
			async () =>
				new Response(bytes, {
					headers: { "content-type": "image/webp", "content-length": "1000" },
				}),
		);
		await expect(store.get(key)).rejects.toMatchObject(unavailable);
		fetch.mockResolvedValueOnce(new Response(bytes, { headers: { "content-type": "image/jpeg" } }));
		await expect(store.get(key)).rejects.toMatchObject(unavailable);
	});

	it("bounds a stalled request and aborts its signal after 30 seconds", async () => {
		vi.useFakeTimers();
		let requestSignal: AbortSignal | undefined;
		let requestStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		const { store } = privateStore(async (request) => {
			requestSignal = request.signal;
			requestStarted?.();
			return new Promise<Response>(() => {
				// Simulate a dependency that ignores abort and never settles.
			});
		});
		const result = expect(store.put(key, photo)).rejects.toMatchObject(unavailable);
		await started;
		await vi.advanceTimersByTimeAsync(30_000);
		await result;
		expect(requestSignal?.aborted).toBe(true);
	});
});
