import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadInternalPortalEnv: vi.fn(),
	runCollectionCommand: vi.fn(async () => 0),
}));

vi.mock("../src/config.js", () => ({
	loadInternalPortalEnv: mocks.loadInternalPortalEnv,
}));
vi.mock("../src/collection-command.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/collection-command.js")>();
	return { ...actual, runCollectionCommand: mocks.runCollectionCommand };
});

import { main } from "../src/collection-cli.js";

describe("local collection CLI", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("loads the managed local environment and runs the shared command", async () => {
		const env = {};
		await expect(main(["--mode", "notice-sync"], env)).resolves.toBe(0);
		expect(mocks.loadInternalPortalEnv).toHaveBeenCalledWith(env);
		expect(mocks.runCollectionCommand).toHaveBeenCalledWith(
			{ mode: "notice-sync" },
			{ env },
		);
	});

	it("prints help without loading runtime configuration", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		await expect(main(["--help"], {})).resolves.toBe(0);
		expect(mocks.loadInternalPortalEnv).not.toHaveBeenCalled();
		expect(mocks.runCollectionCommand).not.toHaveBeenCalled();
		log.mockRestore();
	});
});
