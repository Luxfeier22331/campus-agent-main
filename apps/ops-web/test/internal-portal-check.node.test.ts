// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createStore, runChecks } = vi.hoisted(() => ({
	createStore: vi.fn(),
	runChecks: vi.fn(),
}));

vi.mock("../src/server/internal-portal-credential-service.ts", () => ({
	runScheduledInternalPortalChecks: runChecks,
}));

vi.mock("../src/server/internal-portal-credential-store.ts", async () => ({
	...(await vi.importActual("../src/server/internal-portal-credential-store.ts")),
	createInternalPortalCredentialStoreFromEnv: createStore,
}));

import {
	buildCheckRunEvent,
	buildCheckRunFailureEvent,
	main,
	runCli,
} from "../src/server/internal-portal-check.ts";
import { InternalPortalCredentialStoreUnavailableError } from "../src/server/internal-portal-credential-store.ts";

describe("internal portal scheduled check telemetry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		createStore.mockReturnValue({});
	});

	afterEach(() => {
		process.exitCode = undefined;
		vi.restoreAllMocks();
	});

	it("emits one generic success event after persisted check outcomes", () => {
		expect(buildCheckRunEvent(75)).toEqual({
			duration_ms: 75,
			event_type: "internal_portal.check_run",
			level: "info",
			status: "succeeded",
		});
	});

	it.each([
		"valid",
		"credential_rejected",
		"check_failed",
		"stale",
	] as const)("keeps business outcome %s out of process failure state", async (outcome) => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		runChecks.mockResolvedValue({
			checks: [{ outcome }],
			suspended: [],
		});

		await main();

		expect(process.exitCode).toBeUndefined();
		expect(log).toHaveBeenCalledOnce();
		const serialized = String(log.mock.calls[0]?.[0]);
		expect(JSON.parse(serialized)).toMatchObject({
			event_type: "internal_portal.check_run",
			level: "info",
			status: "succeeded",
		});
		expect(serialized).not.toContain(outcome);
	});

	it("propagates scheduled-check errors to the CLI failure boundary", async () => {
		const error = new Error("database configuration is invalid");
		runChecks.mockRejectedValue(error);

		await expect(main()).rejects.toBe(error);
	});

	it("reports store initialization failure through the real CLI path", async () => {
		createStore.mockImplementation(() => {
			throw new InternalPortalCredentialStoreUnavailableError("store unavailable", {
				cause: new Error("database secret TGT-secret"),
			});
		});
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await runCli(main);

		expect(process.exitCode).toBe(1);
		expect(errorLog).toHaveBeenCalledOnce();
		expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
			failure_kind: "store_unavailable",
			status: "failed",
		});
		expect(String(errorLog.mock.calls[0]?.[0])).not.toContain("TGT-secret");
	});

	it.each([
		[
			new InternalPortalCredentialStoreUnavailableError("store unavailable", {
				cause: new Error("TGT-secret"),
			}),
			"store_unavailable",
		],
		[new Error("unexpected secret TGT-secret"), "unexpected"],
	] as const)("turns infrastructure failure into a redacted CLI event (%s)", async (error, failureKind) => {
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await runCli(async () => {
			throw error;
		});

		expect(process.exitCode).toBe(1);
		expect(errorLog).toHaveBeenCalledOnce();
		const serialized = String(errorLog.mock.calls[0]?.[0]);
		expect(JSON.parse(serialized)).toMatchObject({
			event_type: "internal_portal.check_run",
			failure_kind: failureKind,
			level: "error",
			status: "failed",
		});
		expect(serialized).not.toContain("TGT-secret");
	});

	it("does not serialize credential material from failures", () => {
		const credentialMaterial =
			"Path=/; JSESSIONID=synthetic; nginx=synthetic; SSO_TGC=TGT-synthetic-secret";
		const event = buildCheckRunFailureEvent(
			new InternalPortalCredentialStoreUnavailableError("store unavailable", {
				cause: new Error(credentialMaterial),
			}),
			250,
		);
		const serialized = JSON.stringify(event);

		expect(event).toEqual({
			duration_ms: 250,
			event_type: "internal_portal.check_run",
			failure_kind: "store_unavailable",
			level: "error",
			status: "failed",
		});
		for (const forbidden of ["SSO_TGC", "TGT-synthetic-secret", "JSESSIONID", "nginx"]) {
			expect(serialized).not.toContain(forbidden);
		}
	});
});
