import {
	buildSentrySourceMapUploadArgs,
	buildWorkerVersionUploadArgs,
	resolveWorkerPlainTextVariable,
	selectUploadedVersion,
} from "./worker-version.ts";

const sourceSha = "0123456789abcdef0123456789abcdef01234567";

const uploadArgs = buildWorkerVersionUploadArgs(
	{
		appName: "app-api",
		config: "/tmp/app-api/wrangler.toml",
		environment: "staging",
		secretsFile: "/tmp/app-api/secrets.json",
		variables: {
			SENTRY_RELEASE: "app-api@sha",
			SENTRY_DSN: "https://example.invalid/1",
		},
	},
	sourceSha,
);
expect(uploadArgs.includes("--env") && uploadArgs.includes("staging"), "staging env missing");
expect(uploadArgs.includes(`git-${sourceSha}`), "source tag missing");
expect(uploadArgs.includes("/tmp/app-api/secrets.json"), "Worker secrets file missing");
expect(uploadArgs.includes("SENTRY_DSN:https://example.invalid/1"), "Worker variable missing");
expect(
	!uploadArgs.some((argument) => argument.includes("SENTRY_AUTH_TOKEN")),
	"source-map credential leaked into Wrangler arguments",
);

const sourceMapArgs = buildSentrySourceMapUploadArgs({
	artifactDirectory: "/repo/apps/app-api/dist/sentry/app-api-edge",
	orgSlug: "muc-wiki",
	projectSlug: "app-api",
	release: "app-api@sha",
});
expect(sourceMapArgs.includes("--strict"), "Sentry upload must be strict");
expect(sourceMapArgs.includes("--validate"), "Sentry upload must validate artifacts");
expect(!sourceMapArgs.includes("SENTRY_AUTH_TOKEN"), "Sentry credential leaked into arguments");

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
expect(selected.id === "newer", "latest tagged Worker version was not selected");

const docsReleaseId = `sha256:${"a".repeat(64)}`;
expect(
	resolveWorkerPlainTextVariable(
		{
			resources: {
				bindings: [
					{ name: "OTHER", text: "ignored", type: "plain_text" },
					{ name: "DOCS_RELEASE_ID", text: docsReleaseId, type: "plain_text" },
				],
			},
		},
		"DOCS_RELEASE_ID",
	) === docsReleaseId,
	"selected Worker plain-text variable was not resolved",
);

console.log("worker-version self-test passed.");

function expect(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}
