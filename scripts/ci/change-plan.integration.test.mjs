import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(cwd, command, args, options = {}) {
	const { env: optionEnv = {}, ...runOptions } = options;
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
			TURBO_TELEMETRY_DISABLED: "1",
			...optionEnv,
		},
		...runOptions,
	});
}

function createRepository() {
	const temporaryRoot = mkdtempSync(join(tmpdir(), "campus-agent-change-plan-"));
	const repository = join(temporaryRoot, "repo");
	run(repoRoot, "git", ["clone", "--quiet", "--shared", "--no-checkout", repoRoot, repository]);
	run(repository, "git", ["checkout", "--quiet", "HEAD"]);
	run(repository, "git", ["config", "user.name", "CI Change Plan"]);
	run(repository, "git", ["config", "user.email", "ci-change-plan@example.invalid"]);
	symlinkSync(join(repoRoot, "node_modules"), join(repository, "node_modules"), "dir");
	appendFileSync(join(repository, ".git/info/exclude"), "\nnode_modules\nchange-plan.json\n");
	const plannerFiles = [
		"scripts/ci/change-plan.mjs",
		"scripts/ci/ci-surfaces.mjs",
		"scripts/ci/write-change-plan.sh",
	];
	for (const path of plannerFiles) {
		cpSync(join(repoRoot, path), join(repository, path));
	}
	if (run(repository, "git", ["status", "--porcelain", "--", ...plannerFiles]).trim()) {
		run(repository, "git", ["add", ...plannerFiles]);
		run(repository, "git", ["commit", "--quiet", "--message", "test planner baseline"]);
	}
	return { repository, temporaryRoot };
}

function commit(repository, message) {
	run(repository, "git", ["add", "--all"]);
	run(repository, "git", ["commit", "--quiet", "--message", message]);
	return run(repository, "git", ["rev-parse", "HEAD"]).trim();
}

function plan(repository, base, head) {
	const output = join(repository, "change-plan.json");
	run(repository, "bash", ["scripts/ci/write-change-plan.sh", base, head, output]);
	return JSON.parse(readFileSync(output, "utf8"));
}

async function withRepository(callback) {
	const { repository, temporaryRoot } = createRepository();
	try {
		await callback(repository);
	} finally {
		rmSync(temporaryRoot, { force: true, recursive: true });
	}
}

test("real Git and Turbo routing composes mixed changes without widening releases", async () => {
	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		appendFileSync(join(repository, "apps/app-api/README.md"), "\nCI routing fixture.\n");
		appendFileSync(
			join(repository, "apps/campus-web/test/staging-config.test.ts"),
			"\n// CI routing fixture.\n",
		);
		appendFileSync(join(repository, "turbo.json"), "\n");
		appendFileSync(
			join(repository, "apps/execution-control/internal/telemetry/emitter.go"),
			"\n// Backend publication fixture.\n",
		);
		appendFileSync(
			join(repository, "infra/otel/collector-local-debug.yaml"),
			"\n# OTel routing fixture.\n",
		);
		const head = commit(repository, "mixed routing fixture");
		const result = plan(repository, base, head);
		assert.deepEqual(result.release.images, ["execution-control"]);
		assert.deepEqual(result.release.workers, []);
		assert.equal(result.release.kubernetes, false);
		assert.equal(result.browser, false);
		assert.equal(result.lanes.includes("docs"), true);
		assert.equal(result.affectedPackages.includes("campus-web"), true);
		assert.equal(result.lanes.includes("otel"), true);
	});
});

test("real Git and Turbo routing preserves production deletions and merge results", async () => {
	await withRepository((repository) => {
		const original = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		run(repository, "git", ["switch", "--quiet", "--create", "fixture-pr"]);
		run(repository, "git", ["rm", "apps/app-api/src/base64url.ts"]);
		appendFileSync(join(repository, "apps/campus-web/src/main.tsx"), "\n// PR fixture.\n");
		const pullRequestHead = commit(repository, "production fixture");
		run(repository, "git", ["switch", "--quiet", "--create", "fixture-main", original]);
		appendFileSync(join(repository, "docs/README.md"), "\nMain fixture.\n");
		const updatedBase = commit(repository, "main fixture");
		run(repository, "git", ["merge", "--quiet", "--no-ff", pullRequestHead, "-m", "merge fixture"]);
		const mergeHead = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		const result = plan(repository, updatedBase, mergeHead);
		assert.deepEqual(result.release.workers, ["app-api"]);
		assert.equal(result.browser, true);
		assert.equal(result.lanes.includes("docs"), false);
	});
});

test("lockfile importer and transitive changes select only reachable workspaces", async () => {
	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		const manifestPath = join(repository, "apps/source-collector/package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		delete manifest.dependencies["@campus-agent/telemetry-node"];
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);

		const lockfilePath = join(repository, "pnpm-lock.yaml");
		const lockfile = parseYaml(readFileSync(lockfilePath, "utf8"));
		delete lockfile.importers["apps/source-collector"].dependencies["@campus-agent/telemetry-node"];
		lockfile.packages["crawlee@3.17.0"].resolution.integrity = "sha512-ci-routing-fixture";
		writeFileSync(lockfilePath, stringifyYaml(lockfile));

		const head = commit(repository, "lockfile routing fixture");
		const result = plan(repository, base, head);
		assert.equal(result.affectedPackages.includes("source-collector"), true);
		assert.equal(result.affectedPackages.includes("@campus-agent/dining"), false);
		assert.equal(result.release.workers.includes("campus-web"), false);
	});
});

test("Turbo task inputs route root ingestion configuration without planner package lists", async () => {
	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		appendFileSync(join(repository, "configs/ingestion/tasks.v1.json"), "\n");
		const head = commit(repository, "ingestion configuration fixture");
		const dryRun = JSON.parse(
			run(repository, "pnpm", ["exec", "turbo", "run", "test", "--affected", "--dry=json"], {
				env: { TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head },
			}),
		);
		const packages = new Set(dryRun.tasks.map((task) => task.package));
		assert.equal(packages.has("ingest-core"), true);
		assert.equal(packages.has("ingestion-control"), true);
		assert.equal(packages.has("source-collector"), true);
		assert.equal(packages.has("eval-langfuse"), false);
	});
});
