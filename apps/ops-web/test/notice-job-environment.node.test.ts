// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createDefaultNoticeJobService } from "../src/server/app.ts";
import { NoticeJobUnavailableError } from "../src/server/notice-jobs.ts";

describe("default notice job environment", () => {
	it.each(["local", "development"])("uses the local store in %s", async (environment) => {
		const service = createDefaultNoticeJobService({ DEPLOYMENT_ENVIRONMENT: environment });
		await expect(service.list()).resolves.toEqual([]);
	});

	it("keeps the Kubernetes store outside local development", async () => {
		const service = createDefaultNoticeJobService({ DEPLOYMENT_ENVIRONMENT: "production" });
		await expect(service.list()).rejects.toEqual(expect.any(NoticeJobUnavailableError));
	});
});
