// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/runtime", () => ({
	probeRuntimeDatabase: vi.fn(),
}));

vi.mock("../src/modules/auth", () => ({
	probeAppAuthRuntime: vi.fn(),
}));

import { defaultRuntimeReadinessProbe } from "../src/app/readiness";
import { probeRuntimeDatabase } from "../src/db/runtime";
import { probeAppAuthRuntime } from "../src/modules/auth";

const mockedProbeRuntimeDatabase = vi.mocked(probeRuntimeDatabase);
const mockedProbeAppAuthRuntime = vi.mocked(probeAppAuthRuntime);

const env = {
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("runtime readiness", () => {
	beforeEach(() => {
		mockedProbeRuntimeDatabase.mockReset();
		mockedProbeAppAuthRuntime.mockReset();
		mockedProbeRuntimeDatabase.mockResolvedValue(undefined);
		mockedProbeAppAuthRuntime.mockResolvedValue(undefined);
	});

	it("checks only the service-owned database paths", async () => {
		await expect(defaultRuntimeReadinessProbe(env)).resolves.toEqual({
			dependencies: {
				auth: "ready",
				database: "ready",
			},
			failed: {},
		});
		expect(mockedProbeRuntimeDatabase).toHaveBeenCalledWith(env);
		expect(mockedProbeAppAuthRuntime).toHaveBeenCalledWith(env);
	});

	it("reports each unavailable database path independently", async () => {
		mockedProbeRuntimeDatabase.mockRejectedValue(new Error("cached database unavailable"));
		mockedProbeAppAuthRuntime.mockRejectedValue(new Error("fresh auth database unavailable"));

		await expect(defaultRuntimeReadinessProbe(env)).resolves.toEqual({
			dependencies: {
				auth: "not_ready",
				database: "not_ready",
			},
			failed: {
				auth: "fresh auth database unavailable",
				database: "cached database unavailable",
			},
		});
	});
});
