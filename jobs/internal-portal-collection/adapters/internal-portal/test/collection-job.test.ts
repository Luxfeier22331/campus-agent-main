import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadInternalPortalEnv: vi.fn(),
	resolveCredential: vi.fn(async () => ({
		schemaVersion: "internal-portal-credential-resolution.v1" as const,
		ssoTgc: "TGT-resolved",
	})),
	runCollectionCommand: vi.fn(async () => 0),
}));

vi.mock("../src/config.js", () => ({
	loadInternalPortalEnv: mocks.loadInternalPortalEnv,
}));
vi.mock("../src/collection-command.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/collection-command.js")>();
	return { ...actual, runCollectionCommand: mocks.runCollectionCommand };
});
vi.mock("../src/ops-web-credential-resolver.js", () => ({
	resolveInternalPortalCredentialFromEnv: mocks.resolveCredential,
}));

import { main, parseCollectionJobCommand } from "../src/collection-job.js";

describe("collection Job entry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves one credential before running the selected mode", async () => {
		const env = {};
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		try {
			await expect(main(["file-sync"], env)).resolves.toBe(0);
			expect(log).toHaveBeenCalledWith(
				JSON.stringify({ mode: "file-sync", status: "started" }),
			);
		} finally {
			log.mockRestore();
		}
		expect(mocks.loadInternalPortalEnv).toHaveBeenCalledWith(env);
		expect(mocks.resolveCredential).toHaveBeenCalledWith(env);
		expect(mocks.runCollectionCommand).toHaveBeenCalledWith(
			{ mode: "file-sync" },
			{ env, ssoTgc: "TGT-resolved" },
		);
		expect(mocks.resolveCredential.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.runCollectionCommand.mock.invocationCallOrder[0] as number,
		);
	});

	it("reads only the backfill date from the Job environment", () => {
		expect(parseCollectionJobCommand(["notice-sync"], {})).toEqual({
			mode: "notice-sync",
		});
		expect(parseCollectionJobCommand(["notice-backfill"], {
			INTERNAL_PORTAL_NOTICE_START_DATE: "2026-08-01",
		})).toEqual({ mode: "notice-backfill", startDate: "2026-08-01" });
		expect(() => parseCollectionJobCommand(["notice-backfill"], {})).toThrow(
			"INTERNAL_PORTAL_NOTICE_START_DATE is required",
		);
		expect(() => parseCollectionJobCommand(["--mode", "notice-sync"], {})).toThrow(
			"Usage: notice-sync",
		);
	});

	it("reads a fixed rescan range from the Job environment", () => {
		expect(parseCollectionJobCommand(["notice-rescan"], {
			INTERNAL_PORTAL_NOTICE_FROM: "2026-09-01",
			INTERNAL_PORTAL_NOTICE_TO: "2026-09-14",
		})).toEqual({ mode: "notice-rescan", from: "2026-09-01", to: "2026-09-14" });
		expect(() => parseCollectionJobCommand(["notice-rescan"], {})).toThrow();
	});

	it("does not resolve credentials for help", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["--help"], {})).resolves.toBe(0);
		expect(mocks.loadInternalPortalEnv).not.toHaveBeenCalled();
		expect(mocks.resolveCredential).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
