import { describe, expect, it } from "vitest";
import { buildWorkerVersionUploadArgs } from "../../../scripts/deploy/worker-version";

const sourceSha = "0123456789abcdef0123456789abcdef01234567";

describe("Worker version upload arguments", () => {
	it("does not select an environment for an already-resolved build config", () => {
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "campus-web",
				config: "dist/campus_web/wrangler.json",
				variables: { SENTRY_RELEASE: "campus-web@sha" },
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
				variables: { SENTRY_RELEASE: "app-api@sha" },
			},
			sourceSha,
		);

		expect(args).toEqual(expect.arrayContaining(["--env", "staging", "--tag", `git-${sourceSha}`]));
	});

	it("uses a content-addressed tag for a composite Worker build", () => {
		const buildIdentity = `sha256:${"a".repeat(64)}`;
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "campus-web",
				buildIdentity,
				variables: { DOCS_RELEASE_ID: `sha256:${"b".repeat(64)}` },
			},
			sourceSha,
		);

		expect(args).toEqual(expect.arrayContaining(["--tag", `build-${"a".repeat(64)}`]));
	});
});
