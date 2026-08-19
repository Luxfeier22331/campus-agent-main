import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadInternalPortalEnv: vi.fn(),
	parseNoticeCommand: vi.fn(() => ({ name: "sync" as const, resourceConcurrency: 4 })),
	resolveCredential: vi.fn(async () => ({
		schemaVersion: "internal-portal-credential-resolution.v1" as const,
		ssoTgc: "TGT-resolved",
	})),
	runNoticeCommand: vi.fn(async () => undefined),
}));

vi.mock("../src/config.js", () => ({
	loadInternalPortalEnv: mocks.loadInternalPortalEnv,
}));
vi.mock("../src/notice-cli.js", () => ({
	parseNoticeCommand: mocks.parseNoticeCommand,
	runNoticeCommand: mocks.runNoticeCommand,
}));
vi.mock("../src/ingestion-control-credential-resolver.js", () => ({
	resolveInternalPortalCredentialFromEnv: mocks.resolveCredential,
}));

import { main } from "../src/notice-sync-job.js";

describe("notice sync Job entry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves a credential before invoking the existing sync command", async () => {
		await main(["--concurrency", "6"]);

		expect(mocks.loadInternalPortalEnv).toHaveBeenCalledOnce();
		expect(mocks.parseNoticeCommand).toHaveBeenCalledWith(["sync", "--concurrency", "6"]);
		expect(mocks.resolveCredential).toHaveBeenCalledWith(process.env);
		expect(mocks.runNoticeCommand).toHaveBeenCalledWith(
			{ name: "sync", resourceConcurrency: 4 },
			{ env: process.env, ssoTgc: "TGT-resolved" },
		);
		expect(mocks.resolveCredential.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.runNoticeCommand.mock.invocationCallOrder[0] as number,
		);
	});

	it("does not start sync when credential resolution fails", async () => {
		mocks.resolveCredential.mockRejectedValueOnce(new Error("credential unavailable"));

		await expect(main()).rejects.toThrow("credential unavailable");
		expect(mocks.runNoticeCommand).not.toHaveBeenCalled();
	});
});
