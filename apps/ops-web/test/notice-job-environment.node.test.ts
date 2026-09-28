// @vitest-environment node

import { Connection } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { createDefaultNoticeJobService } from "../src/server/app.ts";
import { NoticeJobUnavailableError } from "../src/server/notice-jobs.ts";

describe("default notice job environment", () => {
	it.each(["local", "development"])("uses the local store in %s", async (environment) => {
		const service = createDefaultNoticeJobService({ DEPLOYMENT_ENVIRONMENT: environment });
		await expect(service.list()).resolves.toEqual([]);
	});

	it("uses the Temporal store outside local development", async () => {
		const service = createDefaultNoticeJobService({
			DEPLOYMENT_ENVIRONMENT: "production",
			TEMPORAL_ADDRESS: "127.0.0.1:1",
		});
		const connect = vi.spyOn(Connection, "connect").mockRejectedValueOnce(new Error("unavailable"));
		try {
			await expect(service.list()).rejects.toEqual(expect.any(NoticeJobUnavailableError));
			expect(connect).toHaveBeenCalledWith({ address: "127.0.0.1:1" });
		} finally {
			connect.mockRestore();
		}
	});
});
