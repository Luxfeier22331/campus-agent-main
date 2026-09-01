import { describe, expect, it } from "vitest";
import { formatWranglerFailure } from "../../../scripts/deploy/run-wrangler-command";
import { buildWorkerVersionUploadArgs } from "../../../scripts/deploy/worker-version";

const sourceSha = "0123456789abcdef0123456789abcdef01234567";

describe("Worker version upload arguments", () => {
	it("reports Wrangler failures without exposing credentials", () => {
		const message = formatWranglerFailure(
			{
				status: 1,
				signal: null,
				stdout: null,
				stderr: "request failed: Bearer secret-token",
				error: undefined,
			} as unknown as ReturnType<typeof import("node:child_process").spawnSync>,
			"Reading current deployment",
			{ CLOUDFLARE_API_TOKEN: "secret-token" },
		);

		expect(message).toContain("Reading current deployment failed");
		expect(message).toContain("exit 1");
		expect(message).not.toContain("secret-token");
		expect(message).toContain("Bearer [redacted]");
	});

	it("does not select an environment for an already-resolved build config", () => {
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "campus-web",
				config: "dist/campus_web/wrangler.json",
				variables: { STATUS_WEB_PUBLIC_ORIGIN: "https://status.example.test" },
			},
			sourceSha,
		);

		expect(args).not.toContain("--env");
		expect(args).toContain("dist/campus_web/wrangler.json");
	});

	it("selects staging when the source config still contains environments", () => {
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "app-api",
				config: "/tmp/app-api/wrangler.toml",
				environment: "staging",
				secretsFile: "/tmp/app-api/secrets.json",
				variables: { AUTH_EMAIL_FROM: "Campus Agent <auth@example.com>" },
			},
			sourceSha,
		);

		expect(args).toEqual(expect.arrayContaining(["--env", "staging", "--tag", `git-${sourceSha}`]));
		expect(args).toEqual(expect.arrayContaining(["--secrets-file", "/tmp/app-api/secrets.json"]));
	});

	it("uses a content-addressed tag for a composite Worker build", () => {
		const buildIdentity = `sha256:${"a".repeat(64)}`;
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "campus-web",
				buildIdentity,
				variables: {},
			},
			sourceSha,
		);

		expect(args).toEqual(expect.arrayContaining(["--tag", `build-${"a".repeat(64)}`]));
	});
});
