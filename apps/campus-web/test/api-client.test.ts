import { afterEach, describe, expect, it, vi } from "vitest";

import { requestJson, UnauthorizedError } from "../src/platform/api/client";

describe("campus app-api client", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps 401 to UnauthorizedError", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ error: { message: "session required" } }), {
				headers: { "content-type": "application/json" },
				status: 401,
			}),
		);

		await expect(requestJson({ path: "/api/me" })).rejects.toBeInstanceOf(UnauthorizedError);
	});

	it("rejects non-json successful responses", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("ok", {
				headers: { "content-type": "text/plain" },
			}),
		);

		await expect(requestJson({ path: "/api/me" })).rejects.toThrow("non-JSON");
	});

	it("returns valid JSON payloads", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(requestJson<{ ok: true }>({ path: "/api/me" })).resolves.toEqual({ ok: true });
	});
});
