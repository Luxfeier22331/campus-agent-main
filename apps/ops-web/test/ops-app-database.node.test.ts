// @vitest-environment node

import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDining, createStatus, createTokenStore } = vi.hoisted(() => ({
	createDining: vi.fn(),
	createStatus: vi.fn(),
	createTokenStore: vi.fn(),
}));

vi.mock("../src/server/dining-stores.ts", async () => ({
	...(await vi.importActual("../src/server/dining-stores.ts")),
	createDiningStores: createDining,
}));
vi.mock("../src/server/internal-portal-automation-token-store.ts", async () => ({
	...(await vi.importActual("../src/server/internal-portal-automation-token-store.ts")),
	createPgInternalPortalAutomationTokenStore: createTokenStore,
}));
vi.mock("../src/server/ops-status-factory.ts", async () => ({
	...(await vi.importActual("../src/server/ops-status-factory.ts")),
	createOpsStatusStore: createStatus,
}));

import { createAllowAllOpsAdmission } from "../src/server/ops-admission.ts";

describe("Ops Web database assembly", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createDining.mockReturnValue({ map: {}, menu: {}, reviews: {} });
		createTokenStore.mockReturnValue({});
		createStatus.mockReturnValue({});
	});

	it("injects the same application pool into every default PostgreSQL adapter", async () => {
		vi.resetModules();
		const { createOpsApp } = await import("../src/server/app.ts");
		const databasePool = { connect: vi.fn(), query: vi.fn() } as unknown as Pool;

		createOpsApp({
			admission: createAllowAllOpsAdmission(),
			databasePool,
			env: { NODE_ENV: "test" },
			staticRoot: "test/fixtures/static",
		});

		expect(createStatus).toHaveBeenCalledWith({
			env: expect.anything(),
			pool: databasePool,
		});
		expect(createDining).toHaveBeenCalledWith({
			env: expect.anything(),
			pool: databasePool,
		});
		expect(createTokenStore).toHaveBeenCalledWith(databasePool);
	});
});
