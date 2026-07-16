import { describe, expect, it } from "vitest";

import { checkFileReleaseAuth } from "../src/auth-check-file-release.js";

describe("internal portal file-release auth check", () => {
	it("checks only the file-release surface", async () => {
		let disposed = false;
		const result = await checkFileReleaseAuth({
			authCheckPageSize: 3,
			createApiContext: async () => ({
				dispose: async () => {
					disposed = true;
				},
				get: async () => response(),
				post: async () => response(),
			}),
			fetchFileReleasePage: async () => ({ data: [{ id: 1 }], state: true }),
		});

		expect(result).toEqual({ fileRelease: { sampleCount: 1 }, ok: true });
		expect(disposed).toBe(true);
	});

	it("fails closed when the file-release API rejects the session", async () => {
		await expect(
			checkFileReleaseAuth({
				authCheckPageSize: 3,
				createApiContext: async () => ({
					dispose: async () => undefined,
					get: async () => response(),
					post: async () => response(),
				}),
				fetchFileReleasePage: async () => ({ state: false }),
			}),
		).rejects.toThrow("auth check failed: file-release surface unavailable");
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
