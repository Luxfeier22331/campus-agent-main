import { describe, expect, it } from "vitest";
import { resolveStagingSentryRelease } from "../../../scripts/deploy/staging-release";
import {
	buildSentrySourceMapUploadArgs,
	buildWorkerVersionUploadArgs,
} from "../../../scripts/deploy/worker-version";

const sourceSha = "0123456789abcdef0123456789abcdef01234567";

describe("Worker version upload arguments", () => {
	it("uses an app-scoped full source SHA for the Sentry release", () => {
		expect(resolveStagingSentryRelease("app-api")).toMatch(/^app-api@[0-9a-f]{40}$/u);
		expect(resolveStagingSentryRelease("campus-web")).toMatch(/^campus-web@[0-9a-f]{40}$/u);
	});
	it("does not select an environment for an already-resolved build config", () => {
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "campus-web",
				config: "dist/campus_web/wrangler.json",
				variables: { DEPLOYMENT_RELEASE: "campus-web@sha" },
			},
			sourceSha,
		);

		expect(args).not.toContain("--env");
		expect(args).toContain("dist/campus_web/wrangler.json");
	});

	it("selects staging when the source config still contains environments", () => {
		const sourceMapDirectory = "/repo/apps/app-api/dist/sentry/app-api-edge";
		const args = buildWorkerVersionUploadArgs(
			{
				appName: "app-api",
				config: "/tmp/app-api/wrangler.toml",
				environment: "staging",
				secretsFile: "/tmp/app-api/secrets.json",
				sentrySourceMaps: {
					artifactDirectory: sourceMapDirectory,
					orgSlug: "muc-wiki",
					projectSlug: "app-api",
					release: "app-api@sha",
					wranglerOutdir: sourceMapDirectory,
				},
				variables: { DEPLOYMENT_RELEASE: "app-api@sha" },
			},
			sourceSha,
		);

		expect(args).toEqual(expect.arrayContaining(["--env", "staging", "--tag", `git-${sourceSha}`]));
		expect(args).toEqual(expect.arrayContaining(["--secrets-file", "/tmp/app-api/secrets.json"]));
		expect(args).toEqual(
			expect.arrayContaining(["--upload-source-maps", "--outdir", sourceMapDirectory]),
		);
	});

	it("rejects a relative Wrangler source-map output directory", () => {
		expect(() =>
			buildWorkerVersionUploadArgs(
				{
					appName: "app-api",
					sentrySourceMaps: {
						artifactDirectory: "dist/sentry/app-api-edge",
						orgSlug: "muc-wiki",
						projectSlug: "app-api",
						release: "app-api@sha",
						wranglerOutdir: "dist/sentry/app-api-edge",
					},
					variables: { DEPLOYMENT_RELEASE: "app-api@sha" },
				},
				sourceSha,
			),
		).toThrow("Wrangler source-map output directory must be absolute");
	});

	it("uploads Sentry artifacts fail-closed without putting credentials in arguments", () => {
		const args = buildSentrySourceMapUploadArgs({
			artifactDirectory: "/repo/apps/app-api/dist/sentry/app-api-edge",
			orgSlug: "muc-wiki",
			projectSlug: "app-api",
			release: "app-api@sha",
		});

		expect(args).toEqual(
			expect.arrayContaining([
				"--org",
				"muc-wiki",
				"--project",
				"app-api",
				"--release",
				"app-api@sha",
				"--strict",
				"--validate",
				"--wait-for",
				"60",
			]),
		);
		expect(args.join(" ")).not.toContain("SENTRY_AUTH_TOKEN");
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
