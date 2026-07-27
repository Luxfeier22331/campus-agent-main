import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	closeObjectStore: vi.fn(async () => undefined),
	createObjectStore: vi.fn(),
	createPortalApiContext: vi.fn(),
	loadState: vi.fn(),
	resolveInternalPortalConfig: vi.fn(),
}));

vi.mock("../../../src/object-store.js", () => ({
	createSourceCollectorObjectStoreFromEnv: mocks.createObjectStore,
}));
vi.mock("../src/config.js", () => ({
	loadInternalPortalEnv: vi.fn(),
	resolveInternalPortalConfig: mocks.resolveInternalPortalConfig,
	resolveInternalPortalSiteId: () => "muc_internal_portal",
}));
vi.mock("../src/notice-state-store.js", () => ({
	createObjectStoreInternalPortalNoticeSyncStateStore: () => ({
		load: mocks.loadState,
		save: vi.fn(),
	}),
}));
vi.mock("../src/portal.js", () => ({
	createPortalApiContext: mocks.createPortalApiContext,
}));

import { main } from "../src/notice-cli.js";

describe("notice CLI", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createObjectStore.mockReturnValue({ close: mocks.closeObjectStore });
		mocks.resolveInternalPortalConfig.mockImplementation(() => {
			throw new Error("full portal config must not be resolved");
		});
	});

	it("reads status without portal auth or unrelated portal configuration", async () => {
		mocks.loadState.mockResolvedValue(null);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await main(["status"]);

		expect(mocks.resolveInternalPortalConfig).not.toHaveBeenCalled();
		expect(mocks.createPortalApiContext).not.toHaveBeenCalled();
		expect(mocks.loadState).toHaveBeenCalledWith("muc_internal_portal");
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});

	it("returns a covered backfill without creating a portal session", async () => {
		mocks.loadState.mockResolvedValue({
			historyCoveredFrom: "2025-01-01",
			incrementalHeadId: 105,
			maxCapturedId: 105,
			minCapturedId: 80,
			siteId: "muc_internal_portal",
			updatedAt: "2026-07-25T00:00:00.000Z",
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		await main(["backfill", "--start-date", "2026-01-01"]);

		expect(mocks.resolveInternalPortalConfig).not.toHaveBeenCalled();
		expect(mocks.createPortalApiContext).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledOnce();
		log.mockRestore();
	});
});
