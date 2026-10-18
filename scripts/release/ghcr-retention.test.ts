import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	applyRetentionPlan,
	type CommandRunner,
	extractGitopsImageDigests,
	fetchManifestClosure,
	intersectRetentionPlans,
	mergeReleaseRoots,
	type PackageInventory,
	parseArgs,
	parseManifestInspection,
	planRetention,
	protectedRootsForInventory,
	RETENTION_ACTIVE_PACKAGE_NAMES,
	RETIRED_IMAGE_NAMES,
	RETIRED_PACKAGE_NAMES,
	readKnownPackageInventory,
	refreshedFullPlan,
	runFullRetention,
	sourceCandidateRoots,
	verifyRetentionDeletion,
} from "./ghcr-retention.mts";
import { ACTIVE_IMAGE_TARGETS } from "./image-targets.mts";

const NOW = new Date("2026-09-04T00:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const tag = (character: string) => character.repeat(40);

test("full apply intersects plans, excluding new deletes and protecting newly selected digests", () => {
	const name = "campus-agent/agent-runtime";
	const before = planRetention({
		mode: "apply",
		packages: inventory({ [name]: [version(1, "a", [tag("a")]), version(2, "b", [tag("b")])] }),
	});
	const fresh = planRetention({
		mode: "apply",
		packages: inventory({
			[name]: [
				version(1, "a", [tag("a")]),
				version(2, "b", [tag("b")]),
				version(3, "c", [tag("c")]),
			],
		}),
		gitopsDigests: { [name]: [digest("b")] },
	});
	const plan = intersectRetentionPlans(before, fresh);
	assert.deepEqual(
		plan.packages
			.find((p) => p.name === name)
			?.versions.map((v) => [v.id, v.action])
			.sort(),
		[
			[1, "delete"],
			[2, "keep"],
			[3, "keep"],
		],
	);
});

test("deletion verification checks both deletion and protected manifest children", () => {
	const name = "campus-agent/agent-runtime";
	const plan = planRetention({
		mode: "apply",
		packages: inventory({
			[name]: [version(1, "a", [tag("a")]), version(2, "b", [tag("b")]), version(3, "c", [])],
		}),
		gitopsDigests: { [name]: [digest("b")] },
		manifestClosure: { [name]: [digest("b"), digest("c")] },
	});
	const after = inventory({ [name]: [version(2, "b", [tag("b")]), version(3, "c", [])] });
	assert.doesNotThrow(() => verifyRetentionDeletion(plan, after));
	assert.throws(
		() =>
			verifyRetentionDeletion(
				plan,
				inventory({
					[name]: [
						version(1, "a", [tag("a")]),
						...(after.find((p) => p.name === name)?.versions ?? []),
					],
				}),
			),
		/did not complete/,
	);
	assert.throws(
		() => verifyRetentionDeletion(plan, inventory({ [name]: [version(2, "b", [tag("b")])] })),
		/Protected digest disappeared/,
	);
});

test("full cleanup refreshes before deletion, records failures, and never deletes in report mode", async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "full-retention-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	for (const scenario of [
		"success",
		"report",
		"refresh-error",
		"delete-error",
		"verify-error",
		"protected",
	]) {
		const name = "campus-agent/agent-runtime";
		const packages = inventory({ [name]: [version(1, "a", [tag("a")])] });
		const mode = scenario === "report" ? "report" : "apply";
		const options = parseArgs([
			"--mode",
			mode,
			"--gitops-root",
			directory,
			"--release-roots",
			path.join(directory, "roots.json"),
			"--output",
			path.join(directory, `${scenario}.json`),
		]);
		let reads = 0;
		let deletes = 0;
		const operation = runFullRetention(options, {
			async readPlan() {
				reads++;
				if (scenario === "refresh-error" && reads === 2) {
					throw new Error("roots unavailable");
				}
				return planRetention({
					mode,
					packages,
					...(scenario === "protected" && reads === 2
						? { gitopsDigests: { [name]: [digest("a")] } }
						: {}),
				});
			},
			async runner(_command, args) {
				assert.equal(reads, 2);
				assert(args.includes("DELETE"));
				deletes++;
				return scenario === "delete-error" ? failedResult : jsonResult({});
			},
			async readInventory() {
				return scenario === "verify-error" || scenario === "protected" ? packages : inventory();
			},
		});
		if (scenario.endsWith("-error")) {
			await assert.rejects(operation);
		} else {
			await operation;
		}
		assert.equal(deletes, ["success", "delete-error", "verify-error"].includes(scenario) ? 1 : 0);
		assert.equal(reads, scenario === "report" ? 1 : 2);
		const result = JSON.parse(await readFile(options.output, "utf8"));
		assert.equal(result.errors.length > 0, scenario.endsWith("-error"));
	}
});

function version(
	id: number,
	character: string,
	tags: string[],
	updatedAt = "2026-09-01T00:00:00Z",
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
	return RETENTION_ACTIVE_PACKAGE_NAMES.map((name) => ({
		name,
		versions: overrides[name] ?? [],
	}));
}

test("retention registers GitOps runtime images outside the build target list", () => {
	const packages = inventory();
	const plan = planRetention({ now: NOW, packages });
	assert.equal(
		plan.packages.find((entry) => entry.name === "campus-agent/internal-portal-collection")
			?.classification,
		"active",
	);
	assert.equal(
		plan.errors.some((error) => error.includes("internal-portal-collection")),
		false,
	);
});

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

test("protects release/deployment roots, cache and OCI children", () => {
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
		gitopsDigests: { "campus-agent/agent-runtime": [current.name, recent.name, previous.name] },
		untaggedGraceDays: 7,
	});
	const runtime = plan.packages.find(
		(candidate) => candidate.name === "campus-agent/agent-runtime",
	);
	assert(runtime);
	const byDigest = new Map(runtime.versions.map((candidate) => [candidate.digest, candidate]));
	assert.equal(byDigest.get(current.name)?.reason, "release-or-deployment-root");
	assert.equal(byDigest.get(recent.name)?.reason, "release-or-deployment-root");
	assert.equal(byDigest.get(previous.name)?.reason, "release-or-deployment-root");
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

test("retains referenced retired packages and rejects unmanaged references", () => {
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
	assert.equal(
		plan.packages.find((entry) => entry.name === RETIRED_PACKAGE_NAMES[0])?.packageAction,
		"retain",
	);
	assert.equal(
		plan.packages.find((entry) => entry.name === RETIRED_PACKAGE_NAMES[0])?.versions[0]?.action,
		"keep",
	);
	assert(plan.errors.some((error) => error.includes("unmanaged package")));
});

test("registered retired packages without GitOps roots are whole-package deletion candidates", () => {
	const packages = RETIRED_IMAGE_NAMES.map((image) => ({
		name: `campus-agent/${image}`,
		versions: [version(200, "9", [], "2026-01-01T00:00:00.000Z")],
	}));
	const plan = planRetention({ now: NOW, packages: [...inventory(), ...packages] });
	assert.deepEqual(plan.errors, []);
	for (const image of RETIRED_IMAGE_NAMES) {
		const retired = plan.packages.find((entry) => entry.name === `campus-agent/${image}`);
		assert.equal(retired?.classification, "retired", image);
		assert.equal(retired?.packageAction, "delete", image);
		assert.equal(retired?.versions[0]?.action, "keep", image);
	}
	assert.equal(plan.totals.deletePackages, RETIRED_IMAGE_NAMES.length);
});

test("only selects explicit roots and the current cache; a recent SHA is not a release", () => {
	const packages = inventory({
		"campus-agent/agent-runtime": [
			version(1, "a", [tag("a")], "2026-09-01T00:00:00.000Z"),
			version(2, "b", [tag("b")], "2026-09-02T00:00:00.000Z"),
			version(3, "c", ["buildcache-arm64"], "2026-09-03T00:00:00.000Z"),
		],
	});
	const roots = protectedRootsForInventory({
		packages,
		gitopsDigests: { "campus-agent/agent-runtime": [digest("a")] },
	});
	assert.deepEqual(
		roots.byPackage["campus-agent/agent-runtime"],
		[digest("a"), digest("c")].sort(),
	);
});

const jsonResult = (value: unknown) => ({ code: 0, stderr: "", stdout: JSON.stringify(value) });
const absentResult = { code: 1, stderr: "gh: Not Found (HTTP 404)", stdout: "" };
const failedResult = { code: 1, stderr: "API unavailable", stdout: "" };

test("CLI requires the full retention roots", () => {
	for (const args of [
		[],
		["--mode", "apply"],
		["--gitops-root", "."],
		["--release-roots", "roots.json"],
		["--gitops-root", ".", "--release-roots", "roots.json", "--untagged-grace-days", "1"],
		["--gitops-root", ".", "--release-roots", "roots.json", "--keep-releases", "5"],
		["--scope", "full", "--gitops-root", ".", "--release-roots", "roots.json"],
	]) {
		assert.throws(() => parseArgs(args));
	}
	const options = parseArgs(["--gitops-root", ".", "--release-roots", "roots.json"]);
	assert.equal(options.mode, "report");
	assert.equal(options.releaseRoots, "roots.json");
});

test("registered inventory fails closed on API, transport, metadata and versions errors", async () => {
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
		await assert.rejects(readKnownPackageInventory("MUC-WIKI", async () => result));
	}
	await assert.rejects(
		readKnownPackageInventory("MUC-WIKI", async (_cmd, args) => {
			const endpoint = args.at(-1) ?? "";
			if (endpoint.includes("/versions?")) {
				return absentResult;
			}
			return jsonResult([{ name: decodeURIComponent(endpoint.split("/container/")[1]) }]);
		}),
		/HTTP 404/,
	);
});

test("registered inventory reads active, retired and Source candidate packages", async () => {
	const name = "campus-agent/agent-runtime";
	const calls: string[] = [];
	const raw = (id: number) => ({
		id,
		name: digest(String(id)),
		created_at: NOW.toISOString(),
		updated_at: NOW.toISOString(),
		metadata: { container: { tags: [] } },
	});
	const result = await readKnownPackageInventory("MUC-WIKI", async (_cmd, args) => {
		const endpoint = args.at(-1) ?? "";
		calls.push(decodeURIComponent(endpoint.split("/container/")[1]?.split("/versions")[0] ?? ""));
		if (!endpoint.includes(encodeURIComponent(name))) {
			return absentResult;
		}
		if (endpoint.includes("/versions?")) {
			assert(args.includes("--paginate"));
			return jsonResult([[raw(1)], [raw(2)]]);
		}
		return jsonResult([{ name }]);
	});
	assert.deepEqual(
		result[0].versions.map((v) => v.id),
		[1, 2],
	);
	assert(calls.includes("campus-agent/source-candidate"));
	for (const retired of RETIRED_PACKAGE_NAMES) {
		assert(calls.includes(retired), `${retired} must be inventoried`);
	}
});

test("release roots union shared digests with in-flight and recoverable candidate tags", () => {
	const roots = { "campus-agent/agent-runtime": [digest("a")] };
	mergeReleaseRoots(
		roots,
		{
			images: { "campus-agent/agent-runtime": [digest("a"), digest("b")] },
			candidateSourceShas: [tag("c")],
		},
		inventory({ "campus-agent/agent-runtime": [version(3, "c", [tag("c")], NOW.toISOString())] }),
	);
	assert.deepEqual(
		roots["campus-agent/agent-runtime"],
		[digest("a"), digest("b"), digest("c")].sort(),
	);
	assert.throws(
		() => mergeReleaseRoots({}, { images: {}, candidateSourceShas: ["bad"] }, []),
		/Invalid candidate/,
	);
	assert.throws(
		() => mergeReleaseRoots({}, { images: { bad: ["not-a-digest"] }, candidateSourceShas: [] }, []),
		/Invalid release roots/,
	);
	assert.throws(() => mergeReleaseRoots({}, {}, []));
});

test("full plan refreshes GitOps refs and dependencies, exports roots, then inspects the registry", async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), "retention-roots-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const rootsFile = path.join(root, "roots.json");
	const options = parseArgs(["--gitops-root", root, "--release-roots", rootsFile]);
	const calls: string[] = [];
	const name = "campus-agent/agent-runtime";
	const plan = await refreshedFullPlan(options, async (command, args) => {
		calls.push(`${command} ${args.join(" ")}`);
		if (command === "oras") {
			return { code: 1, stdout: "", stderr: "404 manifest not found" };
		}
		if (command === "gh" && args.includes("repos/MUC-WIKI/campus-agent-gitops/commits/main")) {
			return jsonResult({ sha: tag("b") });
		}
		if (command === "git") {
			if (args.includes("rev-parse")) {
				return { ...jsonResult({}), stdout: tag("a") };
			}
			if (args.includes("for-each-ref")) {
				return { ...jsonResult({}), stdout: "refs/remotes/origin/deploy/staging" };
			}
			return { ...jsonResult({}), stdout: "" };
		}
		if (command === "pnpm") {
			if (args.includes("roots")) {
				await writeFile(
					rootsFile,
					JSON.stringify({
						images: { [name]: [digest("a")] },
						candidateSourceShas: [],
						sourceCandidateBoundary: null,
					}),
				);
			}
			return jsonResult({});
		}
		if (command === "gh") {
			const endpoint = args.at(-1) ?? "";
			const packageName = decodeURIComponent(
				endpoint.split("/container/")[1].split("/versions")[0],
			);
			if (
				RETIRED_PACKAGE_NAMES.includes(packageName) ||
				packageName === "campus-agent/source-candidate"
			) {
				return absentResult;
			}
			return endpoint.includes("/versions")
				? jsonResult([
						[
							{
								id: 1,
								name: digest("a"),
								created_at: NOW.toISOString(),
								updated_at: NOW.toISOString(),
								metadata: { container: { tags: [tag("a")] } },
							},
						],
					])
				: jsonResult([{ name: packageName }]);
		}
		if (command === "docker") {
			return jsonResult({ manifest: { mediaType: "application/vnd.oci.image.manifest.v1+json" } });
		}
		throw new Error(`Unexpected ${command}`);
	});
	assert.deepEqual(plan.errors, []);
	assert.equal(plan.packages.find((p) => p.name === name)?.versions[0].action, "keep");
	const order = [
		"fetch --prune",
		"checkout --detach",
		"install --frozen-lockfile",
		"tools/release-command.ts roots",
		"gh api --paginate",
		"docker buildx",
	];
	const positions = order.map((pattern) => calls.findIndex((call) => call.includes(pattern)));
	assert(positions.every((position) => position >= 0));
	assert.deepEqual(
		positions,
		[...positions].sort((a, b) => a - b),
	);
	assert(calls.some((call) => call.includes("ls-tree -r --name-only HEAD")));
});

test("mixed GitOps export protects Source images without inventorying GitOps Worker packages", () => {
	const roots: Record<string, string[]> = {};
	const packages = inventory({
		"campus-agent/agent-runtime": [version(1, "a", [tag("a")], NOW.toISOString())],
	});
	mergeReleaseRoots(
		roots,
		{
			images: {
				"campus-agent/agent-runtime": [digest("a")],
				"campus-agent-gitops/worker-app-api": [digest("b")],
			},
			candidateSourceShas: [],
		},
		packages,
	);
	assert.deepEqual(roots, { "campus-agent/agent-runtime": [digest("a")] });
	assert.deepEqual(protectedRootsForInventory({ gitopsDigests: roots, packages }).errors, []);
	mergeReleaseRoots(
		roots,
		{ images: { "campus-agent/unregistered": [digest("c")] }, candidateSourceShas: [] },
		packages,
	);
	assert.deepEqual(protectedRootsForInventory({ gitopsDigests: roots, packages }).errors, [
		"GitOps references unmanaged package campus-agent/unregistered",
	]);
});

test("Source snapshots protect queued handoffs until the successful boundary passes them", async () => {
	const name = "campus-agent/source-candidate";
	const reference = (char: string) => `ghcr.io/muc-wiki/${name}@${digest(char)}`;
	const packages = [
		...inventory(),
		{
			name,
			versions: [
				version(1, "a", [`${tag("a")}-1-1`], "2026-10-01T00:00:00Z"),
				version(2, "b", [`${tag("b")}-2-1`], "2026-10-02T00:00:00Z"),
				version(3, "c", [`${tag("c")}-3-1`, "latest"], "2026-10-03T00:00:00Z"),
			],
		},
	];
	const reads: string[] = [];
	const blobFetches: string[][] = [];
	const runner: CommandRunner = async (command, args) => {
		const ref = args.at(-1);
		assert.ok(ref);
		const char = ref.split("sha256:")[1]?.[0];
		assert.ok(char);
		assert.equal(command, "oras");
		if (args[0] === "manifest") {
			reads.push(ref);
			return jsonResult({
				layers: [
					{
						digest: digest(char),
						annotations: { "org.opencontainers.image.title": "source-release.json" },
					},
				],
			});
		}
		blobFetches.push(args);
		return jsonResult({
			schemaVersion: 2,
			sourceSha: tag(char),
			sourceBases: [],
			baseRevisions: {},
			topologyMigrations: [],
			images: Object.fromEntries(
				ACTIVE_IMAGE_TARGETS.map((image) => [
					image,
					{ sourceSha: tag(char), digest: digest(char) },
				]),
			),
			workers: Object.fromEntries(
				["app-api-staging", "campus-web-staging", "status-web-staging"].map((worker) => [
					worker,
					{ sourceSha: tag(char) },
				]),
			),
		});
	};
	const initial = await sourceCandidateRoots(packages, null, runner);
	assert.deepEqual(initial[name], [digest("a"), digest("b"), digest("c")]);
	assert(
		blobFetches.length > 0 &&
			blobFetches.every((args) => args.slice(0, 4).join(" ") === "blob fetch --output -"),
		`oras blob fetch must write the snapshot to stdout: ${JSON.stringify(blobFetches)}`,
	);
	reads.length = 0;
	const roots = await sourceCandidateRoots(packages, reference("b"), runner);
	assert.deepEqual(reads, [reference("b"), reference("c")]);
	assert.deepEqual(roots["campus-agent/agent-runtime"], [digest("b"), digest("c")]);
	const plan = planRetention({ mode: "report", packages, gitopsDigests: roots });
	assert.deepEqual(
		plan.packages
			.find((p) => p.name === name)
			?.versions.map((v) => [v.digest, v.action])
			.sort(),
		[
			[digest("a"), "delete"],
			[digest("b"), "keep"],
			[digest("c"), "keep"],
		],
	);
	const advanced = await sourceCandidateRoots(packages, reference("c"), runner);
	assert.deepEqual(advanced[name], [digest("c")]);
	await assert.rejects(
		sourceCandidateRoots(packages, reference("d"), runner),
		/missing from the registry/,
	);
});
