import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
	ACTIVE_PACKAGE_NAMES,
	applyRetentionPlan,
	type CommandRunner,
	cancelAndWaitForPrRuns,
	extractGitopsImageDigests,
	fetchManifestClosure,
	type PackageInventory,
	parseArgs,
	parseManifestInspection,
	planPrCacheCleanup,
	planRetention,
	protectedRootsForInventory,
	RETIRED_PACKAGE_NAMES,
	readCachePullRequests,
	readPackageInventory,
	runPrCacheCleanup,
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

test("scoped PR cache cleanup deletes every cache package of a closed PR without grace", () => {
	const name = "campus-agent/pr-cache-442/ops-web";
	const packages = [
		...inventory(),
		{
			name,
			versions: [version(100, "a", ["buildcache-arm64"], "2026-09-03T00:00:00Z")],
		},
		{
			name: "campus-agent/pr-cache-441/ops-web",
			versions: [version(101, "b", [], "2026-08-01T00:00:00Z")],
		},
	];
	const closed = planPrCacheCleanup({
		mode: "apply",
		now: NOW,
		packages,
		prNumber: "442",
		pullRequests: { "442": { state: "closed", closedAt: "2026-09-04T00:00:00.000Z" } },
	});
	assert.deepEqual(closed.errors, []);
	assert.equal(closed.totals.deletePackages, 1);
	assert(closed.packages.every((pkg) => pkg.classification === "pr-cache"));
	const scoped = closed.packages.find((pkg) => pkg.name === name);
	assert.equal(scoped?.packageAction, "delete");
	assert.equal(
		scoped?.versions.every((version) => version.action === "keep"),
		true,
	);
	assert.equal(
		closed.packages.some((pkg) => pkg.name === "campus-agent/pr-cache-441/ops-web"),
		false,
	);

	const open = planPrCacheCleanup({
		mode: "apply",
		now: NOW,
		packages,
		prNumber: "442",
		pullRequests: { "442": { state: "open", closedAt: null } },
	});
	assert(open.errors.some((error) => error.includes("Source PR is not closed")));
	assert.equal(open.packages.find((pkg) => pkg.name === name)?.packageAction, "hold");

	for (const pullRequests of [
		undefined,
		{ "442": { state: "closed" as const, closedAt: "invalid" } },
	]) {
		const unavailable = planPrCacheCleanup({
			mode: "apply",
			now: NOW,
			packages,
			prNumber: "442",
			pullRequests,
		});
		assert(unavailable.errors.some((error) => error.includes("Source PR state unavailable")));
		assert.equal(unavailable.packages.find((pkg) => pkg.name === name)?.packageAction, "hold");
	}

	const empty = planPrCacheCleanup({
		mode: "apply",
		now: NOW,
		packages,
		prNumber: "999",
		pullRequests: {},
	});
	assert.deepEqual(empty.errors, []);
	assert.deepEqual(empty.totals, {
		deletePackages: 0,
		deleteVersions: 0,
		keepVersions: 0,
		packages: 0,
		versions: 0,
	});
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

const REPOSITORY = "MUC-WIKI/campus-agent";
const SOURCE_PR = {
	state: "closed",
	closed_at: "2026-09-04T00:00:00Z",
	head: { ref: "fix/cache", repo: { full_name: REPOSITORY } },
};
const RUN = {
	id: 1,
	run_attempt: 1,
	status: "in_progress",
	event: "pull_request",
	head_branch: "fix/cache",
	head_sha: "a".repeat(40),
	head_repository: { full_name: REPOSITORY },
	pull_requests: [{ number: 442 }],
};
const jsonResult = (value: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify(value) });
const failedResult = { code: 1, stderr: "API unavailable", stdout: "" };

function clock() {
	let elapsed = 0;
	return {
		now: () => elapsed,
		sleep: async (milliseconds: number) => {
			elapsed += milliseconds;
		},
	};
}

test("cancellation waits for terminal runs, includes older heads, and never cancels another PR", async () => {
	const cancellations: string[] = [];
	let polls = 0;
	const runner: CommandRunner = async (_command, args) => {
		const endpoint = args.at(-1) ?? "";
		if (endpoint.endsWith("/pulls/442")) {
			return jsonResult(SOURCE_PR);
		}
		if (endpoint.includes("/workflows/pr.yml/runs?")) {
			polls++;
			return jsonResult([
				{
					workflow_runs: [
						...["queued", "requested", "waiting", "pending", "in_progress"].map((status, i) => ({
							...RUN,
							id: i + 1,
							status: polls >= 3 ? "completed" : status,
							head_sha: String(i).repeat(40),
						})),
						{ ...RUN, id: 6, pull_requests: [{ number: 443 }] },
						{ ...RUN, id: 7, head_repository: { full_name: "fork/campus-agent" } },
					],
				},
			]);
		}
		if (endpoint.endsWith("/cancel")) {
			cancellations.push(endpoint);
			return jsonResult({});
		}
		throw new Error(`Unexpected API call: ${args.join(" ")}`);
	};
	await cancelAndWaitForPrRuns(REPOSITORY, "442", { runner, ...clock() });
	assert.equal(polls, 3);
	assert.deepEqual(
		cancellations,
		[1, 2, 3, 4, 5].map((id) => `repos/${REPOSITORY}/actions/runs/${id}/cancel`),
	);
});

test("missing run association resolves closed unmerged PRs and pre-force-push heads by branch", async () => {
	for (const sha of [RUN.head_sha, "b".repeat(40)]) {
		let stopped = false;
		const runner: CommandRunner = async (_command, args) => {
			const endpoint = args.at(-1) ?? "";
			if (endpoint.endsWith("/pulls/442")) {
				return jsonResult(SOURCE_PR);
			}
			if (endpoint.includes("/workflows/pr.yml/runs?")) {
				return jsonResult([{ workflow_runs: stopped ? [] : [{ ...RUN, pull_requests: [] }] }]);
			}
			if (endpoint.includes("/pulls?")) {
				assert(args.includes("--paginate"));
				const query = new URL(`https://api.github.com/${endpoint}`).searchParams;
				assert.equal(query.get("state"), "all");
				assert.equal(query.get("head"), "MUC-WIKI:fix/cache");
				return jsonResult([
					[
						{
							number: 443,
							head: { ref: "fix/cache", sha, repo: { full_name: "fork/campus-agent" } },
						},
					],
					[
						{ number: 442, state: "closed", merged_at: null, head: { ...SOURCE_PR.head, sha } },
						{ number: 444, head: { ...SOURCE_PR.head, ref: "different-branch", sha } },
					],
				]);
			}
			if (endpoint.endsWith("/cancel")) {
				stopped = true;
				return jsonResult({});
			}
			assert.fail(`Unexpected API call: ${args.join(" ")}`);
		};
		await cancelAndWaitForPrRuns(REPOSITORY, "442", { runner, ...clock() });
		assert.equal(stopped, true);
	}
});

test("reused branches require a unique commit match and leave unrelated runs alone", async () => {
	for (const scenario of [
		"target-head",
		"target-commit",
		"other",
		"shared",
		"missing",
		"api-error",
	] as const) {
		let stopped = false;
		const runner: CommandRunner = async (_command, args) => {
			const endpoint = args.at(-1) ?? "";
			if (endpoint.endsWith("/pulls/442")) {
				return jsonResult(SOURCE_PR);
			}
			if (endpoint.includes("/workflows/pr.yml/runs?")) {
				return jsonResult([{ workflow_runs: stopped ? [] : [{ ...RUN, pull_requests: [] }] }]);
			}
			if (endpoint.includes("/pulls?")) {
				return jsonResult([
					[442, 443].map((number) => ({
						number,
						head: {
							...SOURCE_PR.head,
							sha: scenario === "target-head" && number === 442 ? RUN.head_sha : "b".repeat(40),
						},
					})),
				]);
			}
			if (endpoint.includes("/commits?")) {
				if (scenario === "api-error") {
					return failedResult;
				}
				const target = endpoint.includes("/442/");
				const matches =
					scenario === "shared" ||
					(scenario === "target-commit" && target) ||
					(scenario === "other" && !target);
				return jsonResult([[], matches ? [{ sha: RUN.head_sha }] : []]);
			}
			if (endpoint.endsWith("/cancel")) {
				stopped = true;
				return jsonResult({});
			}
			assert.fail(`Unexpected API call: ${args.join(" ")}`);
		};
		const result = cancelAndWaitForPrRuns(REPOSITORY, "442", { runner, ...clock() });
		if (["shared", "missing", "api-error"].includes(scenario)) {
			await assert.rejects(result, /Cannot identify PR|API unavailable/);
		} else {
			await result;
		}
		assert.equal(stopped, scenario === "target-head" || scenario === "target-commit", scenario);
	}
});

test("cancellation tolerates a run finishing just before the cancel request", async () => {
	let finished = false;
	const runner: CommandRunner = async (_command, args) => {
		const endpoint = args.at(-1) ?? "";
		if (endpoint.endsWith("/pulls/442")) {
			return jsonResult(SOURCE_PR);
		}
		if (endpoint.includes("/workflows/pr.yml/runs?")) {
			return jsonResult([{ workflow_runs: finished ? [] : [RUN] }]);
		}
		if (endpoint.endsWith("/cancel")) {
			finished = true;
			return failedResult;
		}
		if (endpoint.endsWith("/runs/1")) {
			return jsonResult({ ...RUN, status: "completed" });
		}
		throw new Error(`Unexpected API call: ${args.join(" ")}`);
	};
	await cancelAndWaitForPrRuns(REPOSITORY, "442", { runner, ...clock() });
});

test("scoped apply stops before inventory/deletion on cancellation errors and preserves a policy report", async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "ghcr-cleanup-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	for (const scenario of [
		"timeout",
		"cancel-error",
		"list-error",
		"unidentified",
		"reopened",
		"fork",
	] as const) {
		let cancelled = false;
		const runner: CommandRunner = async (_command, args) => {
			const endpoint = args.at(-1) ?? "";
			if (endpoint.endsWith("/pulls/442")) {
				return jsonResult({
					...SOURCE_PR,
					...(scenario === "reopened" && cancelled ? { state: "open" } : {}),
					...(scenario === "fork"
						? { head: { ref: "fix/cache", repo: { full_name: "fork/campus-agent" } } }
						: {}),
				});
			}
			if (endpoint.includes("/workflows/pr.yml/runs?")) {
				return scenario === "list-error"
					? failedResult
					: jsonResult([
							{
								workflow_runs: [
									{ ...RUN, pull_requests: scenario === "unidentified" ? [] : RUN.pull_requests },
								],
							},
						]);
			}
			if (endpoint.includes("/pulls?")) {
				return jsonResult([[]]);
			}
			if (endpoint.endsWith("/cancel")) {
				cancelled = true;
				return scenario === "cancel-error" ? failedResult : jsonResult({});
			}
			if (endpoint.endsWith("/runs/1")) {
				return jsonResult(RUN);
			}
			assert.fail(`Must not access packages after coordination error: ${args.join(" ")}`);
		};
		const output = path.join(directory, `${scenario}.json`);
		await assert.rejects(
			runPrCacheCleanup(
				{ owner: "MUC-WIKI", repository: REPOSITORY, mode: "apply", output },
				"442",
				{ runner, ...clock() },
			),
			/policy errors/,
		);
		const report = JSON.parse(await readFile(output, "utf8"));
		assert.equal(report.errors.length, 1, scenario);
		assert.equal(report.totals.deletePackages, 0, scenario);
		assert(!report.errors[0].includes("Must not access packages"), report.errors[0]);
	}
});

const absentResult = { code: 1, stderr: "gh: Package not found. (HTTP 404)", stdout: "" };

test("scoped inventory directly probes candidates and never reads outside the PR", async () => {
	const name = "campus-agent/pr-cache-442/ops-web";
	const calls: string[] = [];
	const runner: CommandRunner = async (_command, args) => {
		const endpoint = args.at(-1) ?? "";
		calls.push(endpoint);
		assert(endpoint.startsWith("orgs/MUC-WIKI/packages/container/campus-agent%2Fpr-cache-442%2F"));
		if (endpoint.includes(encodeURIComponent(name))) {
			return endpoint.includes("/versions?") ? jsonResult([[], []]) : jsonResult([{ name }]);
		}
		return absentResult;
	};
	assert.deepEqual(await readPackageInventory("MUC-WIKI", runner, "442"), [{ name, versions: [] }]);
	assert.equal(calls.filter((call) => call.includes("/versions?")).length, 1);
	assert.equal(calls.length, ACTIVE_PACKAGE_NAMES.length + 1);
});

test("scoped cleanup cancels before inventory, rechecks PR state, and report mode never cancels", async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "ghcr-cleanup-order-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	for (const scenario of ["apply", "report", "reopened-after-wait"] as const) {
		const calls: string[] = [];
		let finished = false;
		let deleted = false;
		let inventoried = false;
		const name = "campus-agent/pr-cache-442/ops-web";
		const runner: CommandRunner = async (_command, args) => {
			const endpoint = args.at(-1) ?? "";
			calls.push(endpoint);
			if (endpoint.endsWith("/pulls/442")) {
				return jsonResult({
					...SOURCE_PR,
					state: scenario === "reopened-after-wait" && inventoried ? "open" : "closed",
				});
			}
			if (endpoint.includes("/workflows/pr.yml/runs?")) {
				return jsonResult([{ workflow_runs: finished ? [] : [RUN] }]);
			}
			if (endpoint.endsWith("/cancel")) {
				finished = true;
				return jsonResult({});
			}
			if (endpoint.includes("/versions?")) {
				return jsonResult([[]]);
			}
			if (args.includes("DELETE")) {
				deleted = true;
				return jsonResult({});
			}
			if (endpoint.includes("/packages/container/")) {
				assert(scenario === "report" || finished, "inventory must follow cancellation completion");
				inventoried = true;
				return !deleted && endpoint.endsWith(encodeURIComponent(name))
					? jsonResult([{ name }])
					: absentResult;
			}
			throw new Error(`Unexpected API call: ${args.join(" ")}`);
		};
		const cleanup = runPrCacheCleanup(
			{
				owner: "MUC-WIKI",
				repository: REPOSITORY,
				mode: scenario === "report" ? "report" : "apply",
				output: path.join(directory, `${scenario}.json`),
			},
			"442",
			{ runner, ...clock() },
		);
		if (scenario === "reopened-after-wait") {
			await assert.rejects(cleanup, /Source PR is not closed/);
		} else {
			await cleanup;
		}
		assert.equal(deleted, scenario === "apply");
		if (scenario === "report") {
			assert(!calls.some((call) => call.includes("/actions/")));
		}
	}
});

test("CLI requires a positive PR number and rejects legacy retention arguments", () => {
	for (const args of [
		[],
		["--mode", "apply"],
		["--pr-cache-pr", "0"],
		["--pr-cache-pr", "-1"],
		["--pr-cache-pr", "1", "--keep-releases", "5"],
	]) {
		assert.throws(() => parseArgs(args));
	}
	assert.equal(parseArgs(["--pr-cache-pr", "442"]).mode, "report");
});

test("inventory fails closed on API, transport, metadata and versions errors", async () => {
	for (const result of [
		...[400, 401, 403, 422, 500].map((status) => ({
			code: 1,
			stderr: `gh: unavailable (HTTP ${status})`,
			stdout: "",
		})),
		{ code: 1, stderr: 'Get "https://api.github.com": EOF', stdout: "" },
		{ code: 0, stderr: "", stdout: "not JSON" },
		jsonResult([{ name: "wrong-package" }]),
	]) {
		await assert.rejects(readPackageInventory("MUC-WIKI", async () => result, "442"));
	}
	await assert.rejects(
		readPackageInventory(
			"MUC-WIKI",
			async (_cmd, args) => {
				const endpoint = args.at(-1) ?? "";
				if (endpoint.includes("/versions?")) {
					return absentResult;
				}
				return jsonResult([{ name: decodeURIComponent(endpoint.split("/container/")[1]) }]);
			},
			"442",
		),
		/HTTP 404/,
	);
});

test("versions pagination includes every version", async () => {
	const name = "campus-agent/pr-cache-442/agent-runtime";
	const raw = (id: number) => ({
		id,
		name: digest(String(id)),
		created_at: NOW.toISOString(),
		updated_at: NOW.toISOString(),
		metadata: { container: { tags: [] } },
	});
	const result = await readPackageInventory(
		"MUC-WIKI",
		async (_cmd, args) => {
			const endpoint = args.at(-1) ?? "";
			if (!endpoint.includes(encodeURIComponent(name))) {
				return absentResult;
			}
			if (endpoint.includes("/versions?")) {
				assert(args.includes("--paginate"));
				return jsonResult([[raw(1)], [raw(2)]]);
			}
			return jsonResult([{ name }]);
		},
		"442",
	);
	assert.deepEqual(
		result[0].versions.map((v) => v.id),
		[1, 2],
	);
});

test("cleanup reports failures across inventory, deletion and verification; repeated cleanup succeeds", async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "ghcr-errors-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	for (const scenario of [
		"inventory",
		"versions",
		"delete",
		"verify",
		"partial",
		"absent",
		"success",
		"open",
		"dependabot",
		"fork",
	]) {
		const names = ["agent-runtime", "ops-web"].map((image) => `campus-agent/pr-cache-442/${image}`);
		const deleted = new Set<string>();
		let writes = 0;
		const output = path.join(directory, `${scenario}.json`);
		const summary = path.join(directory, `${scenario}.md`);
		const runner: CommandRunner = async (_cmd, args) => {
			const endpoint = args.at(-1) ?? "";
			if (endpoint.endsWith("/pulls/442")) {
				return jsonResult({
					...SOURCE_PR,
					...(scenario === "open" ? { state: "open" } : {}),
					...(scenario === "dependabot" ? { user: { login: "dependabot[bot]" } } : {}),
					...(scenario === "fork" ? { head: { repo: { full_name: "fork/repo" } } } : {}),
				});
			}
			if (endpoint.includes("/workflows/pr.yml/runs?")) {
				return jsonResult([{ workflow_runs: [] }]);
			}
			assert(endpoint.includes("/packages/container/"));
			const name = decodeURIComponent(endpoint.split("/container/")[1].split("/versions?")[0]);
			if (args.includes("DELETE")) {
				writes++;
				if (scenario === "delete" || (scenario === "partial" && writes === 2)) {
					return failedResult;
				}
				deleted.add(name);
				return jsonResult({});
			}
			if (scenario === "inventory") {
				return failedResult;
			}
			if (endpoint.includes("/versions?")) {
				return scenario === "versions" ? absentResult : jsonResult([[]]);
			}
			if (
				scenario === "absent" ||
				!names.includes(name) ||
				(deleted.has(name) && scenario !== "verify")
			) {
				return absentResult;
			}
			return jsonResult([{ name }]);
		};
		const options = {
			owner: "MUC-WIKI",
			repository: REPOSITORY,
			mode: "apply" as const,
			output,
			summary,
		};
		if (["absent", "success"].includes(scenario)) {
			await runPrCacheCleanup(options, "442", { runner });
			await runPrCacheCleanup(options, "442", { runner });
		} else {
			await assert.rejects(runPrCacheCleanup(options, "442", { runner }));
		}
		const report = JSON.parse(await readFile(output, "utf8"));
		assert.equal(report.errors.length > 0, !["absent", "success"].includes(scenario), scenario);
		if (["inventory", "versions", "open", "dependabot", "fork", "absent"].includes(scenario)) {
			assert.equal(writes, 0);
		}
		if (scenario === "partial") {
			assert.equal(deleted.size, 1);
		}
		assert.match(await readFile(summary, "utf8"), /Result:/);
	}
});
