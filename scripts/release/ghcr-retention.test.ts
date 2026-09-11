import assert from "node:assert/strict";
import test from "node:test";

import {
	ACTIVE_PACKAGE_NAMES,
	applyRetentionPlan,
	extractGitopsImageDigests,
	fetchManifestClosure,
	type PackageInventory,
	parseManifestInspection,
	planRetention,
	protectedRootsForInventory,
	RETIRED_PACKAGE_NAMES,
	readCachePullRequests,
} from "./ghcr-retention.mts";

const NOW = new Date("2026-09-04T00:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const tag = (character: string) => character.repeat(40);

test("PR caches protect the current tag, expire history and delete only after closure grace", () => {
	const name = "campus-agent/pr-cache-442/ops-web";
	const packages = [
		...inventory(),
		{
			name,
			versions: [
				version(100, "a", ["buildcache-arm64"], "2026-08-01T00:00:00Z"),
				version(101, "b", [], "2026-08-01T00:00:00Z"),
				version(102, "c", [], "2026-09-03T00:00:00Z"),
			],
		},
	];
	const planned = (pr?: { state: "open" | "closed"; closedAt: string | null }) =>
		planRetention({ now: NOW, packages, pullRequests: pr ? { "442": pr } : {} });
	const open = planned({ state: "open", closedAt: null });
	assert.deepEqual(open.errors, []);
	const cache = open.packages.find((pkg) => pkg.name === name);
	assert.equal(cache?.packageAction, "retain");
	assert.equal(cache?.versions.find((v) => v.id === 100)?.reason, "current-build-cache");
	assert.equal(cache?.versions.find((v) => v.id === 101)?.action, "delete");
	assert.equal(cache?.versions.find((v) => v.id === 102)?.action, "keep");
	assert.equal(
		planned({ state: "closed", closedAt: "2026-08-28T00:00:01Z" }).packages.find(
			(pkg) => pkg.name === name,
		)?.packageAction,
		"retain",
	);
	assert.equal(
		planned({ state: "closed", closedAt: "2026-08-28T00:00:00Z" }).packages.find(
			(pkg) => pkg.name === name,
		)?.packageAction,
		"delete",
	);
	for (const pr of [undefined, { state: "closed" as const, closedAt: "invalid" }]) {
		const plan = planned(pr);
		assert(plan.errors.some((error) => error.includes("Source PR state unavailable")));
		assert(
			plan.packages.find((pkg) => pkg.name === name)?.versions.every((v) => v.action === "keep"),
		);
		assert.notEqual(plan.packages.find((pkg) => pkg.name === name)?.packageAction, "delete");
	}
});

test("PR state lookup deduplicates image packages and holds unavailable state", async () => {
	const packages = ["ops-web", "agent-runtime"].map((image) => ({
		name: `campus-agent/pr-cache-442/${image}`,
		versions: [],
	}));
	const calls: string[][] = [];
	assert.deepEqual(
		await readCachePullRequests(packages, "MUC-WIKI/campus-agent", async (_command, args) => {
			calls.push(args);
			return { code: 0, stderr: "", stdout: JSON.stringify({ state: "open", closed_at: null }) };
		}),
		{ "442": { state: "open", closedAt: null } },
	);
	assert.equal(calls.length, 1);
	assert.deepEqual(
		await readCachePullRequests(packages, "MUC-WIKI/campus-agent", async () => ({
			code: 1,
			stderr: "API unavailable",
			stdout: "",
		})),
		{},
	);
	for (const name of [
		"campus-agent/pr-cache-0/ops-web",
		"campus-agent/pr-cache-442/unregistered",
		"campus-agent/pr-cache-442/ops-web/extra",
	]) {
		const plan = planRetention({ now: NOW, packages: [...inventory(), { name, versions: [] }] });
		assert(plan.errors.some((error) => error.includes("not registered")));
	}
});

function version(
	id: number,
	character: string,
	tags: string[],
	updatedAt: string,
): PackageInventory["versions"][number] {
	return {
		createdAt: updatedAt,
		id,
		name: digest(character),
		tags,
		updatedAt,
	};
}

function inventory(overrides: Partial<Record<string, PackageInventory["versions"]>> = {}) {
	return ACTIVE_PACKAGE_NAMES.map((name) => ({
		name,
		versions: overrides[name] ?? [],
	}));
}

test("extracts inline and Kustomize image digests from deployable GitOps text", () => {
	assert.deepEqual(
		extractGitopsImageDigests(`
images:
  - name: ghcr.io/muc-wiki/campus-agent/agent-runtime
    digest: ${digest("a")}
  - name: ghcr.io/muc-wiki/campus-agent/ops-web
    digest: ${digest("b")}
image: ghcr.io/muc-wiki/campus-agent/model-config@${digest("c")}
historical: ghcr.io/muc-wiki/other/image@${digest("d")}
`),
		{
			"campus-agent/agent-runtime": [digest("a")],
			"campus-agent/model-config": [digest("c")],
			"campus-agent/ops-web": [digest("b")],
		},
	);
});

test("parses an OCI index and retains every child manifest digest", () => {
	const runtime = digest("b");
	const attestation = digest("c");
	const parsed = parseManifestInspection(
		JSON.stringify({
			manifest: {
				mediaType: "application/vnd.oci.image.index.v1+json",
				manifests: [
					{ digest: runtime, mediaType: "application/vnd.oci.image.manifest.v1+json" },
					{ digest: attestation, mediaType: "application/vnd.oci.image.manifest.v1+json" },
				],
			},
		}),
		"test manifest",
	);
	assert.deepEqual(parsed.manifests, [
		{ digest: runtime, mediaType: "application/vnd.oci.image.manifest.v1+json" },
		{ digest: attestation, mediaType: "application/vnd.oci.image.manifest.v1+json" },
	]);
});

test("protects GitOps roots, recent releases, cache and OCI children", () => {
	const current = version(1, "a", [tag("a")], "2026-08-10T00:00:00.000Z");
	const recent = version(2, "b", [tag("b")], "2026-09-03T00:00:00.000Z");
	const previous = version(3, "c", [tag("c")], "2026-09-02T00:00:00.000Z");
	const oldRelease = version(4, "d", [tag("d")], "2026-08-01T00:00:00.000Z");
	const cache = version(5, "e", ["buildcache-arm64"], "2026-09-03T00:00:00.000Z");
	const protectedChild = version(6, "f", [], "2026-08-01T00:00:00.000Z");
	const recentUntagged = version(7, "0", [], "2026-09-03T00:00:00.000Z");
	const oldUntagged = version(8, "1", [], "2026-08-01T00:00:00.000Z");
	const unknownTag = version(9, "2", ["latest"], "2026-08-01T00:00:00.000Z");
	const packages = inventory({
		"campus-agent/agent-runtime": [
			current,
			recent,
			previous,
			oldRelease,
			cache,
			protectedChild,
			recentUntagged,
			oldUntagged,
			unknownTag,
		],
	});
	const plan = planRetention({
		manifestClosure: {
			"campus-agent/agent-runtime": [
				current.name,
				recent.name,
				previous.name,
				cache.name,
				protectedChild.name,
			],
		},
		now: NOW,
		packages,
		gitopsDigests: { "campus-agent/agent-runtime": [current.name] },
		keepLatestReleases: 2,
		untaggedGraceDays: 7,
	});
	const runtime = plan.packages.find(
		(candidate) => candidate.name === "campus-agent/agent-runtime",
	);
	assert(runtime);
	const byDigest = new Map(runtime.versions.map((candidate) => [candidate.digest, candidate]));
	assert.equal(byDigest.get(current.name)?.reason, "gitops-desired-state");
	assert.equal(byDigest.get(recent.name)?.reason, "latest-release-window");
	assert.equal(byDigest.get(previous.name)?.reason, "latest-release-window");
	assert.equal(byDigest.get(cache.name)?.reason, "current-build-cache");
	assert.equal(byDigest.get(protectedChild.name)?.reason, "child-of-protected-manifest");
	assert.equal(byDigest.get(recentUntagged.name)?.reason, "untagged-grace-period");
	assert.equal(byDigest.get(oldUntagged.name)?.action, "delete");
	assert.equal(byDigest.get(oldRelease.name)?.action, "delete");
	assert.equal(byDigest.get(unknownTag.name)?.reason, "unknown-tag:latest");
	assert.equal(plan.totals.deleteVersions, 2);
});

test("plans an explicitly retired package for whole-package deletion", () => {
	const packages = [
		...inventory(),
		{
			name: "campus-agent/app-api-schema",
			versions: [version(99, "9", [tag("9")], "2026-01-01T00:00:00.000Z")],
		},
	];
	const report = planRetention({ now: NOW, packages });
	const retired = report.packages.find(
		(candidate) => candidate.name === "campus-agent/app-api-schema",
	);
	assert.equal(retired?.packageAction, "delete");
	assert.equal(report.totals.deletePackages, 1);

	const purge = planRetention({ now: NOW, packages, mode: "apply" });
	const purged = purge.packages.find(
		(candidate) => candidate.name === "campus-agent/app-api-schema",
	);
	assert.equal(purged?.packageAction, "delete");
	assert.equal(purge.totals.deletePackages, 1);
	assert.equal(purge.totals.deleteVersions, 0);
});

test("does not apply a report plan", async () => {
	const packages = inventory({
		"campus-agent/agent-runtime": [version(1, "a", [tag("a")], "2026-09-01T00:00:00.000Z")],
	});
	const report = planRetention({ now: NOW, packages });
	await assert.rejects(
		applyRetentionPlan(report, "MUC-WIKI", async () => ({ code: 0, stderr: "", stdout: "" })),
		/report plan/u,
	);
});

test("applies only the planned package and version deletions", async () => {
	const packages = inventory({
		"campus-agent/agent-runtime": [
			version(1, "a", [tag("a")], "2026-09-01T00:00:00.000Z"),
			version(2, "b", [tag("b")], "2026-01-01T00:00:00.000Z"),
		],
	});
	const plan = planRetention({
		manifestClosure: { "campus-agent/agent-runtime": [digest("a")] },
		now: NOW,
		packages,
		keepLatestReleases: 1,
		mode: "apply",
	});
	const calls: Array<{ args: string[]; command: string }> = [];
	await applyRetentionPlan(plan, "MUC-WIKI", async (command, args) => {
		calls.push({ args, command });
		return { code: 0, stderr: "", stdout: "" };
	});
	assert.deepEqual(calls, [
		{
			args: [
				"api",
				"--method",
				"DELETE",
				"orgs/MUC-WIKI/packages/container/campus-agent%2Fagent-runtime/versions/2",
			],
			command: "gh",
		},
	]);
});

test("walks nested OCI indexes when protecting a manifest closure", async () => {
	const root = digest("a");
	const nestedIndex = digest("b");
	const runtime = digest("c");
	const calls: string[] = [];
	const closure = await fetchManifestClosure(
		{ "campus-agent/agent-runtime": [root] },
		"MUC-WIKI/campus-agent",
		async (_command, args) => {
			const reference = args[3];
			assert(reference);
			calls.push(reference);
			if (reference.endsWith(`@${root}`)) {
				return {
					code: 0,
					stderr: "",
					stdout: JSON.stringify({
						manifest: {
							mediaType: "application/vnd.oci.image.index.v1+json",
							manifests: [
								{
									digest: nestedIndex,
									mediaType: "application/vnd.oci.image.index.v1+json",
								},
							],
						},
					}),
				};
			}
			return {
				code: 0,
				stderr: "",
				stdout: JSON.stringify({
					manifest: {
						mediaType: "application/vnd.oci.image.index.v1+json",
						manifests: [
							{ digest: runtime, mediaType: "application/vnd.oci.image.manifest.v1+json" },
						],
					},
				}),
			};
		},
	);
	assert.deepEqual(closure, {
		"campus-agent/agent-runtime": [root, nestedIndex, runtime].sort(),
	});
	assert.deepEqual(calls, [
		`ghcr.io/muc-wiki/campus-agent/agent-runtime@${root}`,
		`ghcr.io/muc-wiki/campus-agent/agent-runtime@${nestedIndex}`,
	]);
});

test("reports retired or unmanaged GitOps references as policy errors", () => {
	const packages = [
		...inventory(),
		{
			name: RETIRED_PACKAGE_NAMES[0] as string,
			versions: [version(100, "8", [], "2026-01-01T00:00:00.000Z")],
		},
	];
	const plan = planRetention({
		now: NOW,
		packages,
		gitopsDigests: {
			[RETIRED_PACKAGE_NAMES[0]]: [digest("8")],
			"campus-agent/not-registered": [digest("7")],
		},
	});
	assert(plan.errors.some((error) => error.includes("retired package")));
	assert(plan.errors.some((error) => error.includes("unmanaged package")));
});

test("selects the latest releases and cache tag as protected roots", () => {
	const packages = inventory({
		"campus-agent/agent-runtime": [
			version(1, "a", [tag("a")], "2026-09-01T00:00:00.000Z"),
			version(2, "b", [tag("b")], "2026-09-02T00:00:00.000Z"),
			version(3, "c", ["buildcache-arm64"], "2026-09-03T00:00:00.000Z"),
		],
	});
	const roots = protectedRootsForInventory({
		keepLatestReleases: 1,
		packages,
		gitopsDigests: { "campus-agent/agent-runtime": [digest("a")] },
	});
	assert.deepEqual(
		roots.byPackage["campus-agent/agent-runtime"],
		[digest("a"), digest("b"), digest("c")].sort(),
	);
});
