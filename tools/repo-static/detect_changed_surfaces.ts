import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const surfaceNames = [
	"ci",
	"contracts",
	"deps",
	"eval",
	"go",
	"ingest",
	"web",
	"worker",
] as const;

export type SurfaceName = (typeof surfaceNames)[number];
export type SurfaceMap = Record<SurfaceName, boolean>;

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../..");

export function classifyChangedSurfaces(paths: string[]): SurfaceMap {
	const surfaces = Object.fromEntries(surfaceNames.map((name) => [name, false])) as SurfaceMap;
	for (const path of paths) {
		const normalized = path.trim();
		if (normalized === "") {
			continue;
		}
		if (isGlobalCiPath(normalized)) {
			return Object.fromEntries(surfaceNames.map((name) => [name, true])) as SurfaceMap;
		}
		if (isWebGraphPath(normalized)) {
			surfaces.web = true;
		}
		if (isWorkerRuntimePath(normalized)) {
			surfaces.worker = true;
		}
		if (isContractsPath(normalized)) {
			surfaces.contracts = true;
		}
		if (isDepsPath(normalized)) {
			surfaces.deps = true;
		}
		if (isGoPath(normalized)) {
			surfaces.go = true;
		}
		if (isLangfusePath(normalized)) {
			surfaces.eval = true;
		}
		if (isIngestionContractsPath(normalized)) {
			surfaces.ingest = true;
		}
	}
	return surfaces;
}

export function changedPaths({
	base,
	head,
	root = repoRoot,
}: {
	base: string;
	head: string;
	root?: string;
}): string[] {
	const result = spawnSync(
		"git",
		["-c", "core.quotePath=false", "diff", "--name-only", base, head],
		{
			cwd: root,
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || "git diff failed");
	}
	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function writeGithubOutput(surfaces: SurfaceMap, outputPath: string): void {
	mkdirSync(dirname(outputPath), { recursive: true });
	appendFileSync(
		outputPath,
		`${surfaceNames.map((name) => `${name}=${surfaces[name] ? "true" : "false"}`).join("\n")}\n`,
		"utf8",
	);
}

function isGlobalCiPath(path: string): boolean {
	return [
		".github/workflows/pr.yml",
		".github/workflows/scheduled-health.yml",
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"turbo.json",
		"scripts/check_repo_guard.ts",
		"scripts/check_repo_static.ts",
		"tools/repo-static/detect_changed_surfaces.ts",
		"tools/repo-static/ci-workflow-contracts/core.ts",
		"tools/repo-static/ci-workflow-contracts/fixtures.ts",
		"tools/repo-static/ci-workflow-contracts/lib.ts",
		"tools/repo-static/ci-workflow-contracts/manual.ts",
		"tools/repo-static/ci-workflow-contracts/self-test.ts",
		"tools/repo-static/check_repo_policy.ts",
	].includes(path);
}

function isDepsPath(path: string): boolean {
	return (
		path === "pnpm-lock.yaml" ||
		path === "uv.lock" ||
		path === "pyproject.toml" ||
		path.endsWith("/package.json") ||
		path.endsWith("/go.mod") ||
		path.endsWith("/go.sum")
	);
}

function isWebGraphPath(path: string): boolean {
	return (
		["apps/", "jobs/", "packages/"].some((prefix) => path.startsWith(prefix)) &&
		[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".mts", ".cts"].some((suffix) =>
			path.endsWith(suffix),
		)
	);
}

function isWorkerRuntimePath(path: string): boolean {
	return [
		"apps/app-api/",
		"apps/campus-web/",
		"apps/operator-console-web/",
		"configs/runtime/",
	].some((prefix) => path.startsWith(prefix));
}

function isContractsPath(path: string): boolean {
	return ["packages/contracts/", "configs/runtime/"].some((prefix) => path.startsWith(prefix));
}

function isGoPath(path: string): boolean {
	return ["apps/execution-control/", "configs/runtime/"].some((prefix) => path.startsWith(prefix));
}

function isLangfusePath(path: string): boolean {
	return [
		"packages/eval-langfuse/",
		"packages/ragas-runner/",
		"docs/architecture/system/langfuse.md",
		"docs/contracts/langfuse-runtime.md",
		"docs/decisions/adr-0061-eval-runtime.md",
		"docs/decisions/adr-0062-ragas-langfuse.md",
		"docs/product/langfuse-evals.md",
		"docs/reference/eval.md",
		"docs/reference/eval-map.md",
		"docs/runbooks/eval-ragas.md",
		"packages/eval-langfuse/test/fixtures/langfuse_trace_id_vectors.json",
		"apps/app-api/src/modules/telemetry/",
		"apps/app-api/test/telemetry.index.test.ts",
	].some((prefix) => path.startsWith(prefix));
}

function isIngestionContractsPath(path: string): boolean {
	return path.startsWith("packages/ingestion-contracts/");
}

function runSelfTest(): number {
	const docsOnly = classifyChangedSurfaces(["docs/reference/testing-and-verification-lanes.md"]);
	if (surfaceNames.some((name) => docsOnly[name])) {
		throw new Error("docs-only change should not trigger runtime surfaces");
	}
	const worker = classifyChangedSurfaces(["apps/app-api/src/index.ts"]);
	if (!(worker.web && worker.worker) || worker.go) {
		throw new Error("worker runtime surface classification regressed");
	}
	const runtimeContract = classifyChangedSurfaces([
		"configs/runtime/tool-function-schemas.v1.json",
	]);
	if (!(runtimeContract.contracts && runtimeContract.go && runtimeContract.worker)) {
		throw new Error("runtime contract surface classification regressed");
	}
	const ingestion = classifyChangedSurfaces(["packages/ingest-core/src/index.ts"]);
	if (!ingestion.web || ingestion.ingest || ingestion.worker) {
		throw new Error("ingestion surface classification regressed");
	}
	const ingestionContracts = classifyChangedSurfaces(["packages/ingestion-contracts/src/index.ts"]);
	if (!(ingestionContracts.web && ingestionContracts.ingest)) {
		throw new Error("ingestion contracts surface classification regressed");
	}
	const global = classifyChangedSurfaces(["tools/repo-static/detect_changed_surfaces.ts"]);
	if (surfaceNames.some((name) => !global[name])) {
		throw new Error("global CI surface classification regressed");
	}
	console.log("detect_changed_surfaces self-test passed.");
	return 0;
}

function parseArgs(argv: string[]): {
	base?: string;
	head?: string;
	githubOutput?: string;
	selfTest: boolean;
} {
	let base: string | undefined;
	let head: string | undefined;
	let githubOutput: string | undefined;
	let selfTest = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--base") {
			base = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--head") {
			head = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--github-output") {
			githubOutput = argv[index + 1];
			index += 1;
			continue;
		}
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { base, head, githubOutput, selfTest };
}

function main(argv: string[]): number {
	const args = parseArgs(argv);
	if (args.selfTest) {
		return runSelfTest();
	}
	if (!(args.base && args.head)) {
		throw new Error("--base and --head are required");
	}
	const surfaces = classifyChangedSurfaces(changedPaths({ base: args.base, head: args.head }));
	if (args.githubOutput) {
		writeGithubOutput(surfaces, args.githubOutput);
	} else {
		for (const name of surfaceNames) {
			console.log(`${name}=${surfaces[name] ? "true" : "false"}`);
		}
	}
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
