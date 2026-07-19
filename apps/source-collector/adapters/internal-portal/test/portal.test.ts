import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	PortalCredentialExpiredError,
	PortalCredentialUnavailableError,
} from "../src/auth-errors.js";
import type { InternalPortalConfig } from "../src/config.js";
import { createPortalApiContext, refreshPortalAuthentication } from "../src/portal.js";
import type { ApiResponseLike } from "../src/types.js";

describe("internal portal recovering API context", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const directory of tempDirs.splice(0)) {
			fs.rmSync(directory, { force: true, recursive: true });
		}
	});

	it("bootstraps from the TGC file and atomically persists storage state", async () => {
		const config = createConfig();
		let bootstrapCount = 0;
		const apiContext = await createPortalApiContext(config, {
			bootstrapStorageState: async ({ ssoTgc }) => {
				bootstrapCount += 1;
				return bootstrapResult(ssoTgc, "fresh-session");
			},
			createRequestContext: async () => fakeContext([jsonResponse()]),
		});

		expect(bootstrapCount).toBe(1);
		expect(readStoredCookies(config).get("JSESSIONID")).toBe("fresh-session");
		expect(fs.statSync(config.authStorageStatePath).mode & 0o777).toBe(0o600);
		await apiContext.dispose();
	});

	it("bootstraps independent notice and file-release sessions without a keepalive result", async () => {
		const noticeConfig = createConfig();
		const fileReleaseConfig = createConfig();
		const bootstrapInputs: string[] = [];
		const dependencies = {
			bootstrapStorageState: async ({ ssoTgc }: { ssoTgc: string }) => {
				bootstrapInputs.push(ssoTgc);
				return bootstrapResult(ssoTgc, `session-${bootstrapInputs.length}`);
			},
			createRequestContext: async () => fakeContext([jsonResponse()]),
		};

		const noticeContext = await createPortalApiContext(noticeConfig, dependencies);
		const fileReleaseContext = await createPortalApiContext(fileReleaseConfig, dependencies);

		expect((await noticeContext.post("/notice", { form: {} })).ok()).toBe(true);
		expect((await fileReleaseContext.post("/file-release", { form: {} })).ok()).toBe(true);
		expect(bootstrapInputs).toEqual(["current-ticket", "current-ticket"]);
		await Promise.all([noticeContext.dispose(), fileReleaseContext.dispose()]);
	});

	it("reuses stored state when it contains the current TGC", async () => {
		const config = createConfig();
		writeStorageState(config, storageState("current-ticket", "stored-session"));
		let bootstrapCount = 0;
		const apiContext = await createPortalApiContext(config, {
			bootstrapStorageState: async () => {
				bootstrapCount += 1;
				return bootstrapResult("current-ticket", "unexpected");
			},
			createRequestContext: async (input) => {
				expect(
					input.storageState.cookies.find((cookie) => cookie.name === "JSESSIONID")?.value,
				).toBe("stored-session");
				return fakeContext([jsonResponse()]);
			},
		});

		expect(bootstrapCount).toBe(0);
		await apiContext.dispose();
	});

	it("refreshes before use when the mounted TGC changes", async () => {
		const config = createConfig();
		writeStorageState(config, storageState("old-ticket", "old-session"));
		const apiContext = await createPortalApiContext(config, {
			bootstrapStorageState: async ({ ssoTgc }) => bootstrapResult(ssoTgc, "new-session"),
			createRequestContext: async () => fakeContext([jsonResponse()]),
		});

		expect(readStoredCookies(config).get("SSO_TGC")).toBe("current-ticket");
		expect(readStoredCookies(config).get("JSESSIONID")).toBe("new-session");
		await apiContext.dispose();
	});

	it("refreshes once and retries only the failed request", async () => {
		const config = createConfig();
		writeStorageState(config, storageState("current-ticket", "stale-session"));
		let bootstrapCount = 0;
		let contextCount = 0;
		const apiContext = await createPortalApiContext(config, {
			bootstrapStorageState: async ({ ssoTgc }) => {
				bootstrapCount += 1;
				return bootstrapResult(ssoTgc, "refreshed-session");
			},
			createRequestContext: async () => {
				contextCount += 1;
				return fakeContext([
					contextCount === 1
						? textResponse("error_comsys_session_invalid")
						: jsonResponse({ state: true }),
				]);
			},
		});

		const response = await apiContext.post("/notice", { form: {} });
		expect(await response.text?.()).toBe(JSON.stringify({ state: true }));
		expect(bootstrapCount).toBe(1);
		expect(contextCount).toBe(2);
		await apiContext.dispose();
	});

	it("coalesces concurrent refreshes for the same failed generation", async () => {
		const config = createConfig();
		writeStorageState(config, storageState("current-ticket", "stale-session"));
		let bootstrapCount = 0;
		let contextCount = 0;
		const apiContext = await createPortalApiContext(config, {
			bootstrapStorageState: async ({ ssoTgc }) => {
				bootstrapCount += 1;
				await new Promise((resolve) => setTimeout(resolve, 5));
				return bootstrapResult(ssoTgc, "refreshed-session");
			},
			createRequestContext: async () => {
				contextCount += 1;
				return fakeContext([
					contextCount === 1
						? textResponse("error_comsys_session_invalid")
						: jsonResponse({ state: true }),
				]);
			},
		});

		const first = await apiContext.post("/notice/1", { form: {} });
		const second = await apiContext.post("/notice/2", { form: {} });
		await Promise.all([first.text?.(), second.text?.()]);
		expect(bootstrapCount).toBe(1);
		expect(contextCount).toBe(2);
		await apiContext.dispose();
	});

	it("fails without retry when the refreshed session is still invalid", async () => {
		const config = createConfig();
		writeStorageState(config, storageState("current-ticket", "stale-session"));
		const apiContext = await createPortalApiContext(config, {
			bootstrapStorageState: async ({ ssoTgc }) => bootstrapResult(ssoTgc, "invalid-session"),
			createRequestContext: async () => fakeContext([textResponse("error_comsys_session_invalid")]),
		});
		const response = await apiContext.post("/notice", { form: {} });
		await expect(response.text?.()).rejects.toBeInstanceOf(PortalCredentialExpiredError);
		await apiContext.dispose();
	});

	it("forces a fresh browser SSO round trip even when stored state is current", async () => {
		const config = createConfig();
		writeStorageState(config, storageState("current-ticket", "stored-session"));
		let bootstrapCount = 0;

		const result = await refreshPortalAuthentication(config, {
			bootstrapStorageState: async ({ ssoTgc }) => {
				bootstrapCount += 1;
				return bootstrapResult(ssoTgc, "forced-session");
			},
		});

		expect(bootstrapCount).toBe(1);
		expect(result).toMatchObject({
			noticeProbeSucceeded: true,
			portalSessionEstablished: true,
			serviceTicketIssued: true,
		});
		expect(readStoredCookies(config).get("JSESSIONID")).toBe("forced-session");
	});

	it("fails closed when the credential file is missing or malformed", async () => {
		const missingConfig = createConfig({ writeCredential: false });
		await expect(createPortalApiContext(missingConfig)).rejects.toBeInstanceOf(
			PortalCredentialUnavailableError,
		);

		const malformedConfig = createConfig({ credential: "SSO_TGC=value; Path=/" });
		await expect(createPortalApiContext(malformedConfig)).rejects.toBeInstanceOf(
			PortalCredentialUnavailableError,
		);
	});

	function createConfig(
		options: { credential?: string; writeCredential?: boolean } = {},
	): InternalPortalConfig {
		const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-session-"));
		tempDirs.push(runtimeDir);
		const config: InternalPortalConfig = {
			authCheckNoticeType: "5",
			authCheckPageSize: 3,
			authSsoCookieDomain: ".example.edu",
			authSsoTgcFile: path.join(runtimeDir, "credential", "sso_tgc"),
			authStorageStatePath: path.join(runtimeDir, "auth", "storageState.json"),
			bypassProxyForPortal: true,
			reconcileMaxPagesPerType: null,
			noticeTypesPath: path.join(runtimeDir, "notice-types.json"),
			portalBaseUrl: "https://portal.example.edu",
			portalPageUrl: "https://portal.example.edu/page/11#/",
			portalProxyServer: null,
			requestMaxRetries: 3,
			runtimeDir,
			siteId: "portal_site",
			sourceHomeUrl: "https://portal.example.edu",
		};
		if (options.writeCredential !== false) {
			fs.mkdirSync(path.dirname(config.authSsoTgcFile), { recursive: true });
			fs.writeFileSync(config.authSsoTgcFile, options.credential ?? "current-ticket", "utf-8");
		}
		return config;
	}
});

function fakeContext(responses: ApiResponseLike[]) {
	let index = 0;
	const next = () => {
		const response = responses[Math.min(index++, responses.length - 1)];
		if (!response) {
			throw new Error("fake portal response is missing");
		}
		return response;
	};
	return {
		dispose: async () => undefined,
		get: async () => next(),
		post: async () => next(),
		storageState: async () => storageState("current-ticket", "persisted-session"),
	};
}

function textResponse(payload: string): ApiResponseLike {
	return {
		body: async () => Buffer.from(payload),
		json: async () => JSON.parse(payload),
		ok: () => true,
		status: () => 200,
		statusText: () => "OK",
		text: async () => payload,
	};
}

function jsonResponse(payload: object = { state: true }): ApiResponseLike {
	return textResponse(JSON.stringify(payload));
}

function storageState(tgc: string, jsessionId: string) {
	return {
		cookies: [
			cookie(".example.edu", "SSO_TGC", tgc),
			cookie("portal.example.edu", "JSESSIONID", jsessionId),
		],
		origins: [],
	};
}

function bootstrapResult(tgc: string, jsessionId: string) {
	return {
		result: {
			noticeProbeSucceeded: true as const,
			portalSessionEstablished: true as const,
			refreshedAt: "2026-07-16T00:00:00.000Z",
			serviceTicketIssued: true as const,
		},
		storageState: storageState(tgc, jsessionId),
	};
}

function cookie(domain: string, name: string, value: string) {
	return {
		domain,
		expires: -1,
		httpOnly: true,
		name,
		path: "/",
		sameSite: "Lax" as const,
		secure: true,
		value,
	};
}

function writeStorageState(config: InternalPortalConfig, state: ReturnType<typeof storageState>) {
	fs.mkdirSync(path.dirname(config.authStorageStatePath), { recursive: true });
	fs.writeFileSync(config.authStorageStatePath, JSON.stringify(state), "utf-8");
}

function readStoredCookies(config: InternalPortalConfig): Map<string, string> {
	const state = JSON.parse(fs.readFileSync(config.authStorageStatePath, "utf-8")) as ReturnType<
		typeof storageState
	>;
	return new Map(state.cookies.map((item) => [item.name, item.value]));
}
