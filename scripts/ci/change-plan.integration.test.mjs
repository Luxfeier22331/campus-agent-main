import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function run(cwd, command, args, options = {}) {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${join(repoRoot, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
			TURBO_TELEMETRY_DISABLED: "1",
		},
		...options,
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

test("real Git and Turbo routing keeps non-production changes out of releases", async () => {
	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		appendFileSync(join(repository, "apps/app-api/README.md"), "\nCI routing fixture.\n");
		const head = commit(repository, "docs fixture");
		const result = plan(repository, base, head);
		assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
		assert.equal(result.browser, false);
		assert.deepEqual(result.lanes, ["docs"]);
	});

	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		appendFileSync(
			join(repository, "apps/campus-web/test/staging-config.test.ts"),
			"\n// CI routing fixture.\n",
		);
		const head = commit(repository, "test fixture");
		const result = plan(repository, base, head);
		assert.deepEqual(result.release.workers, []);
		assert.equal(result.browser, false);
		assert.equal(result.lanes.includes("node"), true);
	});

	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		appendFileSync(join(repository, "turbo.json"), "\n");
		const head = commit(repository, "Turbo fixture");
		const result = plan(repository, base, head);
		assert.deepEqual(result.release, { images: [], kubernetes: false, workers: [] });
		assert.equal(result.browser, false);
	});
});

test("real Git and Turbo routing preserves production deletions and merge results", async () => {
	await withRepository((repository) => {
		const base = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		run(repository, "git", ["rm", "apps/app-api/src/base64url.ts"]);
		const head = commit(repository, "delete production fixture");
		assert.deepEqual(plan(repository, base, head).release.workers, ["app-api"]);
	});

	await withRepository((repository) => {
		const original = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		run(repository, "git", ["switch", "--quiet", "--create", "fixture-pr"]);
		appendFileSync(join(repository, "apps/campus-web/src/main.tsx"), "\n// PR fixture.\n");
		const pullRequestHead = commit(repository, "production fixture");
		run(repository, "git", ["switch", "--quiet", "--create", "fixture-main", original]);
		appendFileSync(join(repository, "docs/README.md"), "\nMain fixture.\n");
		const updatedBase = commit(repository, "main fixture");
		run(repository, "git", ["merge", "--quiet", "--no-ff", pullRequestHead, "-m", "merge fixture"]);
		const mergeHead = run(repository, "git", ["rev-parse", "HEAD"]).trim();
		const result = plan(repository, updatedBase, mergeHead);
		assert.deepEqual(result.release.workers, ["campus-web"]);
		assert.equal(result.browser, true);
		assert.equal(result.lanes.includes("docs"), false);
	});
});
