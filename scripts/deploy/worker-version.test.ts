import assert from "node:assert/strict";
import test from "node:test";

import {
	buildSentrySourceMapUploadArgs,
	buildWorkerVersionUploadArgs,
	resolveWorkerPlainTextVariable,
	selectUploadedVersion,
} from "./worker-version.ts";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

test("builds staging Worker upload arguments without leaking source-map credentials", () => {
	const args = buildWorkerVersionUploadArgs(
		{
			appName: "app-api",
			config: "/tmp/app-api/wrangler.toml",
			environment: "staging",
			secretsFile: "/tmp/app-api/secrets.json",
			variables: {
				DEPLOYMENT_RELEASE: "app-api@sha",
				SENTRY_DSN: "https://example.invalid/1",
			},
		},
		SOURCE_SHA,
	);

	assert.ok(args.includes("--env"));
	assert.ok(args.includes("staging"));
	assert.ok(args.includes(`git-${SOURCE_SHA}`));
	assert.ok(args.includes("/tmp/app-api/secrets.json"));
	assert.ok(args.includes("SENTRY_DSN:https://example.invalid/1"));
	assert.ok(!args.some((argument) => argument.includes("SENTRY_AUTH_TOKEN")));
});

test("builds strict Sentry source-map upload arguments", () => {
	const args = buildSentrySourceMapUploadArgs({
		artifactDirectory: "/repo/apps/app-api/dist/sentry/app-api-edge",
		orgSlug: "muc-wiki",
		projectSlug: "app-api",
		release: "app-api@sha",
	});

	assert.ok(args.includes("--strict"));
	assert.ok(args.includes("--validate"));
	assert.ok(!args.includes("SENTRY_AUTH_TOKEN"));
});

test("selects the latest uploaded Worker version with the requested tag", () => {
	const selected = selectUploadedVersion(
		[
			{
				id: "older",
				metadata: { created_on: "2026-01-01T00:00:00.000Z" },
				annotations: { "workers/tag": "release-tag" },
			},
			{
				id: "newer",
				metadata: { created_on: "2026-01-02T00:00:00.000Z" },
				annotations: { "workers/tag": "release-tag" },
			},
		],
		"release-tag",
	);

	assert.equal(selected.id, "newer");
});

test("resolves a selected Worker plain-text variable", () => {
	const buildMetadataId = `sha256:${"a".repeat(64)}`;
	assert.equal(
		resolveWorkerPlainTextVariable(
			{
				resources: {
					bindings: [
						{ name: "OTHER", text: "ignored", type: "plain_text" },
						{ name: "BUILD_METADATA_ID", text: buildMetadataId, type: "plain_text" },
					],
				},
			},
			"BUILD_METADATA_ID",
		),
		buildMetadataId,
	);
});
