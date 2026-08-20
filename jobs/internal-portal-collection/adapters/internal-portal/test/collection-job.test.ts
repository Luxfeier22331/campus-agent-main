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
vi.mock("../src/ingestion-control-credential-resolver.js", () => ({
	resolveInternalPortalCredentialFromEnv: mocks.resolveCredential,
}));

import { main } from "../src/collection-job.js";

describe("collection Job entry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("resolves one credential before running the selected mode", async () => {
		const env = {};
		await expect(main(["--mode", "file-sync"], env)).resolves.toBe(0);
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

	it("does not resolve credentials for help", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["--help"], {})).resolves.toBe(0);
		expect(mocks.loadInternalPortalEnv).not.toHaveBeenCalled();
		expect(mocks.resolveCredential).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
