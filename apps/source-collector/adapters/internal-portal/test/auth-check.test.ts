import { describe, expect, it } from "vitest";

import { checkAuth } from "../src/auth-check.js";

describe("internal portal source collector auth check", () => {
	it("checks only the notice surface and disposes the request context", async () => {
		let disposed = false;
		const result = await checkAuth({
			authCheckNoticeType: "5",
			authCheckPageSize: 3,
			createApiContext: async () => ({
				dispose: async () => {
					disposed = true;
				},
				get: async () => response(),
				post: async () => response(),
			}),
			fetchNoticePage: async () => ({
				datas: { tables: [{ notice_id: 355119 }] },
				state: true,
			}),
		});

		expect(result).toEqual({ ok: true, notice: { sampleCount: 1 } });
		expect(disposed).toBe(true);
	});

	it("fails closed when the notice API rejects the session", async () => {
		await expect(
			checkAuth({
				authCheckNoticeType: "5",
				authCheckPageSize: 3,
				createApiContext: async () => ({
					dispose: async () => undefined,
					get: async () => response(),
					post: async () => response(),
				}),
				fetchNoticePage: async () => ({ state: false }),
			}),
		).rejects.toThrow("auth check failed: notice surface unavailable");
	});
});

function response() {
	return {
		json: async () => ({}),
		ok: () => true,
		status: () => 200,
		statusText: () => "OK",
	};
}
