import assert from "node:assert/strict";
import type { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	buildSentrySourceMapUploadArgs,
	buildWorkerVersionUploadArgs,
	resolveWorkerPlainTextVariable,
	uploadStagingWorkerVersion,
} from "./worker-version.ts";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const VERSION_ID = "11111111-1111-1111-1111-111111111111";
const NEW_VERSION_ID = "22222222-2222-2222-2222-222222222222";
const WORKER_NAME = "app-api-staging";
const TAG = `git-${SOURCE_SHA}`;
const MESSAGE = `MUC-WIKI/campus-agent@${SOURCE_SHA} (app-api)`;

function apiResponse(result: unknown, status = 200): Response {
	return Response.json({ result, success: status >= 200 && status < 300 }, { status });
}

function apiErrorResponse(status: number, code: number): Response {
	return Response.json(
		{
			errors: [{ code, message: "Worker not found" }],
			result: null,
			success: false,
		},
		{ status },
	);
}

function versionDetails(
	id: string,
	variables: Record<string, string>,
	options: { bindings?: Record<string, unknown>[]; message?: string; tag?: string } = {},
): Record<string, unknown> {
	return {
		annotations: {
			"workers/message": options.message ?? MESSAGE,
			"workers/tag": options.tag ?? TAG,
		},
		id,
		resources: {
			bindings: [
				...Object.entries(variables).map(([name, text]) => ({
					name,
					text,
					type: "plain_text",
				})),
				...(options.bindings ?? []),
			],
		},
	};
}

function wranglerSuccess(): ReturnType<typeof spawnSync> {
	return {
		error: undefined,
		output: [],
		pid: 1,
		signal: null,
		status: 0,
		stderr: null,
		stdout: null,
	};
}

const workerOptions = {
	appName: "app-api",
	cwd: "/repo/apps/app-api",
	sentrySourceMaps: {
		artifactDirectory: "dist/sentry",
		orgSlug: "muc-wiki",
		projectSlug: "app-api",
		release: `app-api@${SOURCE_SHA}`,
		wranglerOutdir: "/tmp/app-api-sentry",
	},
	variables: { DEPLOYMENT_RELEASE: `app-api@${SOURCE_SHA}` },
	workerName: WORKER_NAME,
};

const workerEnv = {
	CLOUDFLARE_ACCOUNT_ID: "account-id",
	CLOUDFLARE_API_TOKEN: "api-token",
	SENTRY_AUTH_TOKEN: "sentry-token",
};

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

	assert.deepEqual(args.slice(0, 2), ["versions", "upload"]);
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

test("uploads and verifies a new Worker version before returning its candidate", async () => {
	let uploaded = false;
	let sourceMapUploads = 0;
	const calls: string[] = [];
	const fetcher: typeof fetch = async (input, init) => {
		const url = String(input);
		calls.push(url);
		assert.equal(new Headers(init?.headers).get("authorization"), "Bearer api-token");
		if (url.endsWith("?deployable=true")) {
			return apiResponse({
				items: uploaded
					? [{ id: VERSION_ID, metadata: { created_on: "2026-08-13T12:00:00Z" } }]
					: [],
			});
		}
		assert(url.endsWith(`/versions/${VERSION_ID}`));
		return apiResponse(versionDetails(VERSION_ID, workerOptions.variables));
	};
	const result = await uploadStagingWorkerVersion(workerOptions, {
		env: workerEnv,
		fetch: fetcher,
		resolveSourceSha: () => SOURCE_SHA,
		runWrangler: () => {
			uploaded = true;
			return wranglerSuccess();
		},
		uploadSourceMaps: () => {
			sourceMapUploads += 1;
		},
	});

	assert.deepEqual(result, {
		sourceSha: SOURCE_SHA,
		versionId: VERSION_ID,
		workerName: WORKER_NAME,
	});
	assert.equal(sourceMapUploads, 1);
	assert.equal(calls.filter((url) => url.endsWith("?deployable=true")).length, 2);
});

test("reuses a matching deployable Worker version beyond Wrangler's ten-item output", async (t) => {
	const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "worker-version-test-"));
	t.after(() => rm(outputDirectory, { force: true, recursive: true }));
	const outputFile = path.join(outputDirectory, "candidate.json");
	const oldVersions = Array.from({ length: 11 }, (_, index) => ({
		annotations: { "workers/tag": `other-${index}` },
		id: `${String(index + 16).padStart(8, "0")}-0000-0000-0000-000000000000`,
		metadata: { created_on: `2026-08-${String(13 - index).padStart(2, "0")}T12:00:00Z` },
	}));
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("?deployable=true")) {
			return apiResponse({
				items: [
					...oldVersions,
					{ id: VERSION_ID, metadata: { created_on: "2026-07-01T12:00:00Z" } },
				],
			});
		}
		assert(url.endsWith(`/versions/${VERSION_ID}`));
		return apiResponse(versionDetails(VERSION_ID, workerOptions.variables));
	};
	let wranglerCalls = 0;
	const wranglerArguments: string[][] = [];
	let sourceMapUploads = 0;
	const result = await uploadStagingWorkerVersion(workerOptions, {
		env: { ...workerEnv, WORKER_VERSION_OUTPUT: outputFile },
		fetch: fetcher,
		resolveSourceSha: () => SOURCE_SHA,
		runWrangler: (args) => {
			wranglerCalls += 1;
			wranglerArguments.push(args);
			return wranglerSuccess();
		},
		uploadSourceMaps: () => {
			sourceMapUploads += 1;
		},
	});

	assert.equal(result.versionId, VERSION_ID);
	assert.equal(wranglerCalls, 1);
	assert(wranglerArguments[0]?.includes("--dry-run"));
	assert.equal(sourceMapUploads, 1);
	assert.equal(JSON.parse(await readFile(outputFile, "utf8")).versionId, VERSION_ID);
});

test("uploads a new Worker version when a tagged version has mismatched identity", async () => {
	let uploaded = false;
	let wranglerCalls = 0;
	let sourceMapUploads = 0;
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("?deployable=true")) {
			return apiResponse({
				items: [
					...(uploaded
						? [{ id: NEW_VERSION_ID, metadata: { created_on: "2026-08-13T13:00:00Z" } }]
						: []),
					{ id: VERSION_ID, metadata: { created_on: "2026-08-13T12:00:00Z" } },
				],
			});
		}
		if (url.endsWith(`/versions/${NEW_VERSION_ID}`)) {
			return apiResponse(versionDetails(NEW_VERSION_ID, workerOptions.variables));
		}
		assert(url.endsWith(`/versions/${VERSION_ID}`));
		return apiResponse(versionDetails(VERSION_ID, { DEPLOYMENT_RELEASE: "app-api@different" }));
	};
	const result = await uploadStagingWorkerVersion(workerOptions, {
		env: workerEnv,
		fetch: fetcher,
		resolveSourceSha: () => SOURCE_SHA,
		runWrangler: () => {
			wranglerCalls += 1;
			uploaded = true;
			return wranglerSuccess();
		},
		uploadSourceMaps: () => {
			sourceMapUploads += 1;
		},
	});

	assert.equal(result.versionId, NEW_VERSION_ID);
	assert.equal(wranglerCalls, 1);
	assert.equal(sourceMapUploads, 1);
});

test("uploads a new Worker version when current secrets cannot be compared", async () => {
	let uploaded = false;
	let wranglerCalls = 0;
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("?deployable=true")) {
			return apiResponse({
				items: [
					...(uploaded
						? [{ id: NEW_VERSION_ID, metadata: { created_on: "2026-08-13T13:00:00Z" } }]
						: []),
					{ id: VERSION_ID, metadata: { created_on: "2026-08-13T12:00:00Z" } },
				],
			});
		}
		const versionId = url.endsWith(`/versions/${NEW_VERSION_ID}`) ? NEW_VERSION_ID : VERSION_ID;
		return apiResponse(versionDetails(versionId, workerOptions.variables));
	};
	const result = await uploadStagingWorkerVersion(
		{ ...workerOptions, secretsFile: "/tmp/secrets.json" },
		{
			env: workerEnv,
			fetch: fetcher,
			resolveSourceSha: () => SOURCE_SHA,
			runWrangler: () => {
				wranglerCalls += 1;
				uploaded = true;
				return wranglerSuccess();
			},
			uploadSourceMaps: () => undefined,
		},
	);

	assert.equal(result.versionId, NEW_VERSION_ID);
	assert.equal(wranglerCalls, 1);
});

test("uploads a new Worker version when an environment binding changed", async () => {
	let uploaded = false;
	let wranglerCalls = 0;
	const expectedBindings = [
		{
			name: "STATUS_SNAPSHOT",
			properties: { namespace_id: "b".repeat(32) },
			type: "kv_namespace",
		},
	];
	const fetcher: typeof fetch = async (input) => {
		const url = String(input);
		if (url.endsWith("?deployable=true")) {
			return apiResponse({
				items: [
					...(uploaded
						? [{ id: NEW_VERSION_ID, metadata: { created_on: "2026-08-13T13:00:00Z" } }]
						: []),
					{ id: VERSION_ID, metadata: { created_on: "2026-08-13T12:00:00Z" } },
				],
			});
		}
		const current = url.endsWith(`/versions/${NEW_VERSION_ID}`);
		return apiResponse(
			versionDetails(current ? NEW_VERSION_ID : VERSION_ID, workerOptions.variables, {
				bindings: [
					{
						name: "STATUS_SNAPSHOT",
						namespace_id: (current ? "b" : "a").repeat(32),
						type: "kv_namespace",
					},
				],
			}),
		);
	};
	const result = await uploadStagingWorkerVersion(
		{ ...workerOptions, expectedBindings },
		{
			env: workerEnv,
			fetch: fetcher,
			resolveSourceSha: () => SOURCE_SHA,
			runWrangler: () => {
				wranglerCalls += 1;
				uploaded = true;
				return wranglerSuccess();
			},
			uploadSourceMaps: () => undefined,
		},
	);

	assert.equal(result.versionId, NEW_VERSION_ID);
	assert.equal(wranglerCalls, 1);
});

test("fails closed before upload when Cloudflare version inspection fails", async () => {
	let wranglerCalls = 0;
	await assert.rejects(
		uploadStagingWorkerVersion(workerOptions, {
			env: workerEnv,
			fetch: async () => apiResponse(undefined, 503),
			resolveSourceSha: () => SOURCE_SHA,
			runWrangler: () => {
				wranglerCalls += 1;
				return wranglerSuccess();
			},
		}),
		/Cloudflare API request for Worker versions failed with HTTP 503/u,
	);
	assert.equal(wranglerCalls, 0);
});

for (const errorCode of [10007, 10090]) {
	test(`requires environment provisioning when Worker lookup fails with ${errorCode}`, async () => {
		let wranglerCalls = 0;
		await assert.rejects(
			uploadStagingWorkerVersion(workerOptions, {
				env: workerEnv,
				fetch: async () => apiErrorResponse(404, errorCode),
				resolveSourceSha: () => SOURCE_SHA,
				runWrangler: () => {
					wranglerCalls += 1;
					return wranglerSuccess();
				},
			}),
			/Worker app-api-staging does not exist\. Provision its first deployment through the environment-owned Cloudflare workflow before publishing candidate versions\./u,
		);
		assert.equal(wranglerCalls, 0);
	});
}

test("does not misclassify an unrelated Cloudflare 404 as a missing Worker", async () => {
	let wranglerCalls = 0;
	await assert.rejects(
		uploadStagingWorkerVersion(workerOptions, {
			env: workerEnv,
			fetch: async () => apiErrorResponse(404, 10000),
			resolveSourceSha: () => SOURCE_SHA,
			runWrangler: () => {
				wranglerCalls += 1;
				return wranglerSuccess();
			},
		}),
		/Cloudflare API request for Worker versions failed with HTTP 404/u,
	);
	assert.equal(wranglerCalls, 0);
});

test("rejects a non-object Cloudflare response before upload", async () => {
	let wranglerCalls = 0;
	await assert.rejects(
		uploadStagingWorkerVersion(workerOptions, {
			env: workerEnv,
			fetch: async () => Response.json(null, { status: 502 }),
			resolveSourceSha: () => SOURCE_SHA,
			runWrangler: () => {
				wranglerCalls += 1;
				return wranglerSuccess();
			},
		}),
		/Cloudflare API returned an invalid response for Worker versions/u,
	);
	assert.equal(wranglerCalls, 0);
});
