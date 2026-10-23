import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pullInternalPortalAuth, type AuthPullDependencies } from "../src/auth-cli.js";
import { resolveInternalPortalCredential } from "../src/ops-web-credential-resolver.js";

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
		const responses = [
			"staging-admin\n",
			"campus-agent-staging",
			Buffer.from("internal-token").toString("base64"),
		];
		const runKubectl = vi.fn<NonNullable<AuthPullDependencies["runKubectl"]>>(
			async () => responses.shift() ?? "",
		);
		const close = vi.fn<() => Promise<void>>(async () => undefined);
		const startPortForward = vi.fn<NonNullable<AuthPullDependencies["startPortForward"]>>(async () => ({
			close,
			url: "http://127.0.0.1:43127",
		}));
		const resolveCredential = vi.fn<typeof resolveInternalPortalCredential>(async () => ({
			schemaVersion: "internal-portal-credential-resolution.v1" as const,
			ssoTgc: "TGT-resolved",
		}));

		expect(
			await pullInternalPortalAuth({
				envPath,
				resolveCredential,
				runKubectl,
				startPortForward,
			}),
		).toEqual({
			context: "staging-admin",
			envPath,
			namespace: "campus-agent-staging",
		});
		expect(runKubectl.mock.calls[0]?.[0]).toEqual(["config", "current-context"]);
		const secretArgs = runKubectl.mock.calls[2]?.[0] ?? [];
		expect(secretArgs).toContain("--context");
		expect(secretArgs).toContain("staging-admin");
		expect(secretArgs).toContain("--namespace");
		expect(secretArgs).toContain("campus-agent-staging");
		expect(secretArgs).toContain("ops-web-internal-secrets");
		expect(startPortForward.mock.calls[0]?.[0]).toEqual({
			context: "staging-admin",
			kubectlPath: "kubectl",
			namespace: "campus-agent-staging",
		});
		expect(resolveCredential.mock.calls[0]?.[0]).toEqual({
			token: "internal-token",
			url: "http://127.0.0.1:43127",
		});
		expect(close).toHaveBeenCalledOnce();
		expect(
			await readFile(envPath, "utf8"),
		).toBe(
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
		const close = vi.fn<() => Promise<void>>(async () => undefined);
		const responses = ["staging-admin", "", Buffer.from("internal-token").toString("base64")];

		await expect(
			pullInternalPortalAuth({
				envPath,
				resolveCredential: async () => {
					throw new Error("synthetic resolution failure");
				},
				runKubectl: async () => responses.shift() ?? "",
				startPortForward: async () => ({ close, url: "http://127.0.0.1:43127" }),
			}),
		).rejects.toThrow("synthetic resolution failure");
		expect(await readFile(envPath, "utf8")).toBe(original);
		expect(close).toHaveBeenCalledOnce();
	});
});
