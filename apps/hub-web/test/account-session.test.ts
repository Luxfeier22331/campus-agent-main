import { describe, expect, it, vi } from "vitest";

import { loadAccountSession } from "../src/routes/account-session";

describe("hub account session loader", () => {
	it("treats invalid JSON success payloads as service unavailable", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response("{", {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(loadAccountSession(fetchImplementation)).resolves.toEqual({
			email: null,
			state: "service_unavailable",
		});
	});

	it("does not treat missing principal email as logged out", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify({ principal: {} }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(loadAccountSession(fetchImplementation)).resolves.toEqual({
			email: null,
			state: "service_unavailable",
		});
	});

	it("keeps explicit 401 responses as unauthenticated", async () => {
		const fetchImplementation = vi.fn(async () => new Response("unauthorized", { status: 401 }));

		await expect(loadAccountSession(fetchImplementation)).resolves.toEqual({
			email: null,
			state: "unauthenticated",
		});
	});
});
