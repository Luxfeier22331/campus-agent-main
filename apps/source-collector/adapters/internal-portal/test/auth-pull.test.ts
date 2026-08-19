import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { pullInternalPortalAuth } from "../src/auth-pull.js";

const temporaryDirectories: string[] = [];
const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
	);
});

describe("internal portal auth pull", () => {
	it("uses the current context and namespace, then atomically updates the managed env", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "campus-agent-auth-pull-"));
		temporaryDirectories.push(directory);
		const envPath = resolve(directory, ".env.local");
		await writeFile(
			envPath,
			`${MANAGED_LOCAL_ENV_MARKER}\nOBJECT_STORE_BUCKET_SOURCE="campus-agent-source"\n`,
		);
		const runKubectl = vi
			.fn<(args: string[]) => Promise<string>>()
			.mockResolvedValueOnce("staging-admin\n")
			.mockResolvedValueOnce("campus-agent-staging")
			.mockResolvedValueOnce(Buffer.from("internal-token").toString("base64"));
		const close = vi.fn(async () => undefined);
		const startPortForward = vi.fn(async () => ({ close, url: "http://127.0.0.1:43127" }));
		const resolveCredential = vi.fn(async () => ({
			schemaVersion: "internal-portal-credential-resolution.v1" as const,
			ssoTgc: "TGT-resolved",
		}));

		await expect(
			pullInternalPortalAuth({
				envPath,
				resolveCredential,
				runKubectl,
				startPortForward,
			}),
		).resolves.toEqual({
			context: "staging-admin",
			envPath,
			namespace: "campus-agent-staging",
		});
		expect(runKubectl).toHaveBeenNthCalledWith(1, ["config", "current-context"]);
		expect(runKubectl).toHaveBeenNthCalledWith(
			3,
			expect.arrayContaining([
				"--context",
				"staging-admin",
				"--namespace",
				"campus-agent-staging",
				"ops-web-internal-secrets",
			]),
		);
		expect(startPortForward).toHaveBeenCalledWith({
			context: "staging-admin",
			kubectlPath: "kubectl",
			namespace: "campus-agent-staging",
		});
		expect(resolveCredential).toHaveBeenCalledWith({
			token: "internal-token",
			url: "http://127.0.0.1:43127",
		});
		expect(close).toHaveBeenCalledOnce();
		expect(await readFile(envPath, "utf8")).toBe(
			`${MANAGED_LOCAL_ENV_MARKER}\nOBJECT_STORE_BUCKET_SOURCE="campus-agent-source"\nINTERNAL_PORTAL_SSO_TGC="TGT-resolved"\n`,
		);
		expect((await stat(envPath)).mode & 0o777).toBe(0o600);
	});

	it("leaves the env unchanged when resolution fails", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "campus-agent-auth-pull-"));
		temporaryDirectories.push(directory);
		const envPath = resolve(directory, ".env.local");
		const original = `${MANAGED_LOCAL_ENV_MARKER}\nOBJECT_STORE_BUCKET_SOURCE="campus-agent-source"\n`;
		await writeFile(envPath, original);
		const close = vi.fn(async () => undefined);

		await expect(
			pullInternalPortalAuth({
				envPath,
				resolveCredential: vi.fn(async () => {
					throw new Error("synthetic resolution failure");
				}),
				runKubectl: vi
					.fn<(args: string[]) => Promise<string>>()
					.mockResolvedValueOnce("staging-admin")
					.mockResolvedValueOnce("")
					.mockResolvedValueOnce(Buffer.from("internal-token").toString("base64")),
				startPortForward: vi.fn(async () => ({ close, url: "http://127.0.0.1:43127" })),
			}),
		).rejects.toThrow("synthetic resolution failure");
		expect(await readFile(envPath, "utf8")).toBe(original);
		expect(close).toHaveBeenCalledOnce();
	});
});
