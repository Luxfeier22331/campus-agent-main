import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PortalCredentialExpiredError } from "../src/auth-errors.js";
import {
	AUTH_KEEPALIVE_INTERVAL_MS,
	readAuthKeepaliveStatus,
	runAuthKeepalive,
	runAuthKeepaliveAttempt,
} from "../src/auth-keepalive.js";
import type { InternalPortalConfig } from "../src/config.js";

const config: InternalPortalConfig = {
	authSsoCookieDomain: ".example.edu",
	authSsoTgc: "TGT-current",
	authSsoTgcFile: null,
	portalBaseUrl: "https://portal.example.edu",
	portalPageUrl: "https://portal.example.edu/page/11#/",
	portalProxyServer: null,
	siteId: "synthetic_internal_portal",
	sourceHomeUrl: "https://portal.example.edu",
};

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("internal portal local auth keepalive", () => {
	it("records an immediate successful use without persisting the credential", async () => {
		const statusPath = createStatusPath();
		const onStatus = vi.fn();

		const status = await runAuthKeepaliveAttempt({
			abortSignal: new AbortController().signal,
			dependencies: {
				checkAuthentication: async () => undefined,
				loadConfig: () => config,
				now: sequenceClock("2026-07-27T10:00:00.000Z", "2026-07-27T10:00:03.000Z"),
				onStatus,
				statusPath,
			},
			previousStatus: null,
			statusPath,
		});

		expect(status).toEqual({
			lastAttemptAt: "2026-07-27T10:00:00.000Z",
			lastOutcome: "valid",
			lastSuccessfulAt: "2026-07-27T10:00:03.000Z",
		});
		expect(readAuthKeepaliveStatus(statusPath)).toEqual(status);
		expect(readFileSync(statusPath, "utf8")).not.toContain("TGT-current");
		expect(onStatus).toHaveBeenCalledWith(status);
	});

	it("keeps the last success when the current credential is rejected", async () => {
		const statusPath = createStatusPath();
		const onError = vi.fn();
		const previousStatus = {
			lastAttemptAt: "2026-07-27T09:30:00.000Z",
			lastOutcome: "valid" as const,
			lastSuccessfulAt: "2026-07-27T09:30:02.000Z",
		};

		const status = await runAuthKeepaliveAttempt({
			abortSignal: new AbortController().signal,
			dependencies: {
				checkAuthentication: async () => {
					throw new PortalCredentialExpiredError();
				},
				loadConfig: () => config,
				now: sequenceClock("2026-07-27T10:00:00.000Z"),
				onError,
				onStatus: () => undefined,
			},
			previousStatus,
			statusPath,
		});

		expect(status).toEqual({
			lastAttemptAt: "2026-07-27T10:00:00.000Z",
			lastOutcome: "credential_rejected",
			lastSuccessfulAt: "2026-07-27T09:30:02.000Z",
		});
		expect(onError).toHaveBeenCalledOnce();
	});

	it("classifies dependency failures separately from credential rejection", async () => {
		const statusPath = createStatusPath();

		const status = await runAuthKeepaliveAttempt({
			abortSignal: new AbortController().signal,
			dependencies: {
				checkAuthentication: async () => {
					throw new Error("portal unavailable");
				},
				loadConfig: () => config,
				now: sequenceClock("2026-07-27T10:00:00.000Z"),
				onError: () => undefined,
				onStatus: () => undefined,
			},
			previousStatus: null,
			statusPath,
		});

		expect(status.lastOutcome).toBe("check_failed");
		expect(status.lastSuccessfulAt).toBeNull();
	});

	it("reloads configuration before every fixed-interval attempt", async () => {
		const statusPath = createStatusPath();
		const abortController = new AbortController();
		const loadConfig = vi
			.fn<() => InternalPortalConfig>()
			.mockReturnValueOnce(config)
			.mockReturnValueOnce({ ...config, authSsoTgc: "TGT-replaced" });
		const checkAuthentication = vi.fn(async (currentConfig?: InternalPortalConfig) => {
			if (currentConfig?.authSsoTgc === "TGT-replaced") {
				abortController.abort();
			}
		});
		const wait = vi.fn(async () => undefined);

		await runAuthKeepalive(abortController.signal, {
			checkAuthentication,
			loadConfig,
			now: () => new Date("2026-07-27T10:00:00.000Z"),
			onStatus: () => undefined,
			statusPath,
			wait,
		});

		expect(loadConfig).toHaveBeenCalledTimes(2);
		expect(checkAuthentication.mock.calls.map(([value]) => value?.authSsoTgc)).toEqual([
			"TGT-current",
			"TGT-replaced",
		]);
		expect(wait).toHaveBeenCalledOnce();
		expect(wait).toHaveBeenCalledWith(AUTH_KEEPALIVE_INTERVAL_MS, abortController.signal);
	});

	it("rejects a malformed existing status instead of silently replacing it", () => {
		const statusPath = createStatusPath();
		writeFileSync(statusPath, '{"lastOutcome":"valid"}\n', "utf8");

		expect(() => readAuthKeepaliveStatus(statusPath)).toThrow(
			`invalid internal portal auth status: ${statusPath}`,
		);
	});
});

function createStatusPath(): string {
	const directory = mkdtempSync(path.join(tmpdir(), "internal-portal-auth-"));
	temporaryDirectories.push(directory);
	return path.join(directory, ".auth-status.json");
}

function sequenceClock(...timestamps: string[]): () => Date {
	let index = 0;
	return () => {
		const timestamp = timestamps[index] ?? timestamps.at(-1);
		index += 1;
		if (!timestamp) {
			throw new Error("test clock requires at least one timestamp");
		}
		return new Date(timestamp);
	};
}
