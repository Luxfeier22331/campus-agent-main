import { describe, expect, it, vi } from "vitest";

import { fetcher, fetchWithErrorHandlers } from "../src/platform/vendor-compat/lib/utils";

describe("public chat vendor compat fetch utilities", () => {
	it("rejects invalid JSON success payloads from fetcher", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("{", {
						headers: { "content-type": "application/json" },
						status: 200,
					}),
			),
		);

		await expect(fetcher("/api/chat")).rejects.toThrow(
			"Vendor compat fetcher returned invalid JSON.",
		);
	});

	it("rejects invalid JSON success payloads from fetchWithErrorHandlers", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("{", {
						headers: { "content-type": "application/json" },
						status: 200,
					}),
			),
		);

		await expect(fetchWithErrorHandlers("/api/chat")).rejects.toThrow(
			"Vendor compat fetch returned invalid JSON.",
		);
	});
});
