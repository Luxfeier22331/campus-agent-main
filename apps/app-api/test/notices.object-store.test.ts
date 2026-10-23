// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createNoticeObjectStore } from "../src/modules/notices";

const credentials = {
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "derived-read-access",
	OBJECT_STORE_DERIVED_READ_SECRET_KEY: "derived-read-secret",
};

describe("notice object store", () => {
	it("signs the exact derived notice object for the deployed private binding", async () => {
		const privateFetch = vi.fn(async (request: Request) => {
			expect(request.url).toBe(
				`http://object-store/campus-agent-derived/notices/assets/sha256/${"a".repeat(64)}`,
			);
			expect(request.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
			expect(request.headers.get("authorization")).toContain("Credential=derived-read-access/");
			return new Response(new Uint8Array([1, 2, 3]));
		});
		const store = createNoticeObjectStore({
			...credentials,
			DEPLOYMENT_ENVIRONMENT: "staging",
			OBJECT_STORE_PRIVATE: { fetch: privateFetch },
		});

		const response = await store.get("a".repeat(64));

		expect(response?.status).toBe(200);
		expect(privateFetch).toHaveBeenCalledOnce();
	});

	it("uses the local derived base and maps missing objects to null", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(function (this: unknown) {
			expect(this).toBe(globalThis);
			return Promise.resolve(new Response(null, { status: 404 }));
		});
		const store = createNoticeObjectStore({
			...credentials,
			DEPLOYMENT_ENVIRONMENT: "development",
			OBJECT_STORE_LOCAL_BASE_URL: "http://127.0.0.1:9000/local-derived/",
		});

		await expect(store.get("b".repeat(64))).resolves.toBeNull();
		const request = fetchMock.mock.calls[0]?.[0];
		expect(request).toBeInstanceOf(Request);
		expect((request as Request).url).toBe(
			`http://127.0.0.1:9000/local-derived/notices/assets/sha256/${"b".repeat(64)}`,
		);
		fetchMock.mockRestore();
	});

	it("fails when the existing read identity is missing", async () => {
		const store = createNoticeObjectStore({
			DEPLOYMENT_ENVIRONMENT: "development",
			OBJECT_STORE_LOCAL_BASE_URL: "http://127.0.0.1:9000/local-derived/",
		});

		await expect(store.get("a".repeat(64))).rejects.toMatchObject({
			code: "service_unavailable",
			status: 503,
		});
	});
});
