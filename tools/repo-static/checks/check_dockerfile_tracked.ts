import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const dockerfilePathspecs = [
	"Dockerfile*",
	"*.dockerfile",
	"apps/**/Dockerfile*",
	"jobs/**/Dockerfile*",
];
const allowedDockerContextReincludeRoots = new Set([
	"!apps/agent-runtime/",
	"!apps/execution-control/",
	"!apps/ingestion-control/",
	"!apps/source-collector/",
	"!jobs/dining-sync/",
	"!packages/contracts/",
	"!packages/domains/",
	"!packages/eval-langfuse/",
	"!packages/ingest-core/",
	"!packages/ingestion-contracts/",
	"!packages/ingestion-kernels-rs/",
	"!packages/ragas-runner/",
]);

export function trackedDockerfiles(root = repoRoot): string[] {
	return worktreePaths(root, dockerfilePathspecs);
}

export function selectAffectedDockerfiles(paths: string[], root = repoRoot): string[] {
	if (paths.includes(".hadolint.yaml")) {
		return trackedDockerfiles(root);
	}
	const seen = new Set<string>();
	const selected: string[] = [];
	for (const path of paths) {
		const candidate = join(root, path);
		if (!(isDockerfilePath(path) && existsSync(candidate)) || seen.has(path)) {
			continue;
		}
		seen.add(path);
		selected.push(candidate);
	}
	return selected;
}

export function buildLocalHadolintCommand(path: string, root = repoRoot): string[] {
	return ["hadolint", "-c", join(root, ".hadolint.yaml"), relativePosix(root, path)];
}

export function buildDockerHadolintCommand(path: string, root = repoRoot): string[] {
	return [
		"docker",
		"run",
		"--rm",
		"-v",
		`${root}:/work`,
		"-w",
		"/work",
		"hadolint/hadolint",
		"hadolint",
		"-c",
		"/work/.hadolint.yaml",
		relativePosix(root, path),
	];
}

function isDockerfilePath(path: string): boolean {
	const name = basename(path);
	return name.startsWith("Dockerfile") || path.endsWith(".dockerfile");
}

function worktreePaths(root: string, pathspecs: string[]): string[] {
	const result = spawnSync(
		"git",
		[
			"-c",
			"core.quotePath=false",
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			...pathspecs,
		],
		{ cwd: root, encoding: "buffer" },
	);
	if (result.status !== 0) {
		throw new Error(String(result.stderr || result.stdout || "git ls-files failed"));
	}
	const paths: string[] = [];
	const seen = new Set<string>();
	for (const item of result.stdout.toString("utf8").split("\0")) {
		if (item === "" || seen.has(item)) {
			continue;
		}
		seen.add(item);
		const path = join(root, item);
		if (existsSync(path)) {
			paths.push(path);
		}
	}
	return paths;
}

function commandExists(command: string): boolean {
	const result = spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
	return result.status === 0;
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function dockerignoreEntries(root = repoRoot): string[] {
	return readFileSync(join(root, ".dockerignore"), "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
}

function dockerignorePatterns(root = repoRoot): Set<string> {
	return new Set(dockerignoreEntries(root));
}

function dockerContextReincludeRoots(root = repoRoot): string[] {
	return dockerignoreEntries(root).filter(
		(entry) =>
			entry.endsWith("/") &&
			(entry.startsWith("!apps/") || entry.startsWith("!jobs/") || entry.startsWith("!packages/")),
	);
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectSubset(subset: string[], set: Set<string>, label: string): void {
	for (const item of subset) {
		expect(set.has(item), `${label} missing ${item}`);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	const dockerfile = join(repoRoot, "apps", "execution-control", "Dockerfile");
	expectEqualJson(
		buildLocalHadolintCommand(dockerfile),
		["hadolint", "-c", join(repoRoot, ".hadolint.yaml"), "apps/execution-control/Dockerfile"],
		"local hadolint command",
	);
	expectEqualJson(
		buildDockerHadolintCommand(dockerfile).slice(0, 8),
		["docker", "run", "--rm", "-v", `${repoRoot}:/work`, "-w", "/work", "hadolint/hadolint"],
		"docker hadolint command prefix",
	);
	expectEqualJson(
		buildDockerHadolintCommand(dockerfile).slice(8),
		["hadolint", "-c", "/work/.hadolint.yaml", "apps/execution-control/Dockerfile"],
		"docker hadolint command suffix",
	);
	expect(
		selectAffectedDockerfiles(["apps/campus-web/src/index.ts"]).length === 0,
		"unrelated affected path selected Dockerfiles",
	);
	expectEqualJson(
		selectAffectedDockerfiles(["apps/execution-control/Dockerfile"]),
		[dockerfile],
		"affected Dockerfile selection",
	);

	const patterns = dockerignorePatterns();
	expectSubset(
		[
			"!package.json",
			"!pnpm-lock.yaml",
			"!pnpm-workspace.yaml",
			"!apps/source-collector/",
			"!apps/source-collector/**",
		],
		patterns,
		"source collector dockerignore inputs",
	);
	expectSubset(
		["!jobs/dining-sync/", "!jobs/dining-sync/**", "!packages/domains/", "!packages/domains/**"],
		patterns,
		"dining sync dockerignore inputs",
	);
	expectSubset(
		[
			"!apps/agent-runtime/",
			"!apps/agent-runtime/**",
			"!configs/runtime/tool-function-schemas.v1.json",
			"!configs/runtime/tools.v4.json",
		],
		patterns,
		"agent runtime dockerignore inputs",
	);
	expectSubset(
		[
			"!apps/ingestion-control/",
			"!apps/ingestion-control/**",
			"!packages/ingestion-contracts/",
			"!packages/ingestion-contracts/**",
			"!packages/contracts/",
			"!packages/contracts/**",
			"!configs/runtime/",
			"!configs/runtime/intent-policy.v1.json",
			"!configs/runtime/provider-pricing.v1.json",
			"!configs/runtime/query-serving-scopes.v2.json",
			"!configs/runtime/workflow-artifacts.v2.json",
		],
		patterns,
		"execution and ingestion dockerignore inputs",
	);
	expectEqualJson(
		dockerContextReincludeRoots().sort(),
		[...allowedDockerContextReincludeRoots].sort(),
		"Docker context app/job/package reinclude roots",
	);

	const entries = dockerignoreEntries();
	const lastAppReinclude = Math.max(
		...[
			"!apps/source-collector/**",
			"!apps/agent-runtime/**",
			"!apps/ingestion-control/**",
			"!jobs/dining-sync/**",
			"!packages/domains/**",
		].map((pattern) => entries.indexOf(pattern)),
	);
	for (const pattern of ["**/node_modules", "**/node_modules/**", "**/.turbo", "**/.turbo/**"]) {
		expect(entries.includes(pattern), `${pattern} missing from .dockerignore`);
		expect(entries.indexOf(pattern) > lastAppReinclude, `${pattern} should follow app reincludes`);
	}

	const executionDockerfile = readFileSync(
		join(repoRoot, "apps", "execution-control", "Dockerfile"),
		"utf8",
	);
	const contractCopy =
		"COPY packages/contracts/fixtures/tool_execution_contract /src/packages/contracts/fixtures/tool_execution_contract";
	expect(
		executionDockerfile.includes(contractCopy),
		"execution-control contract fixture copy missing",
	);
	expect(
		executionDockerfile.indexOf(contractCopy) < executionDockerfile.indexOf("RUN go test ./..."),
		"contract fixture copy should happen before go test",
	);
	const toolRegistryCopy = "COPY configs/runtime/tools.v4.json /src/configs/runtime/tools.v4.json";
	const toolSchemaCopy =
		"COPY configs/runtime/tool-function-schemas.v1.json /src/configs/runtime/tool-function-schemas.v1.json";
	expect(executionDockerfile.includes(toolRegistryCopy), "tool registry copy missing");
	expect(executionDockerfile.includes(toolSchemaCopy), "tool schema copy missing");
	expect(
		executionDockerfile.indexOf(toolRegistryCopy) <
			executionDockerfile.indexOf("RUN go test ./..."),
		"tool registry copy should happen before go test",
	);
	expect(
		executionDockerfile.indexOf(toolSchemaCopy) < executionDockerfile.indexOf("RUN go test ./..."),
		"tool schema copy should happen before go test",
	);
	expect(
		executionDockerfile.includes(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: checking literal Dockerfile ARG expansion.
			'CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/activity-worker-agent ./cmd/activity-worker-agent',
		),
		"activity worker build missing",
	);
	expect(
		executionDockerfile.includes(
			"COPY --from=build /out/activity-worker-agent /usr/local/bin/activity-worker-agent",
		),
		"activity worker copy missing",
	);

	console.log("check_dockerfile_tracked self-test passed.");
	return 0;
}

function parseArgs(argv: string[]): { affected?: string[]; selfTest: boolean } {
	let selfTest = false;
	let affected: string[] | undefined;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--self-test") {
			selfTest = true;
			continue;
		}
		if (arg === "--affected") {
			affected = argv.slice(index + 1);
			break;
		}
		throw new Error(`unsupported argument: ${arg}`);
	}
	return { affected, selfTest };
}

function main(argv: string[]): number {
	const args = parseArgs(argv);
	if (args.selfTest) {
		return runSelfTest();
	}
	const files = args.affected ? selectAffectedDockerfiles(args.affected) : trackedDockerfiles();
	if (files.length === 0) {
		console.log("No current-worktree Dockerfiles matched the requested pathspecs.");
		return 0;
	}
	let commandBuilder: (path: string, root?: string) => string[];
	if (commandExists("hadolint")) {
		commandBuilder = buildLocalHadolintCommand;
	} else if (commandExists("docker")) {
		commandBuilder = buildDockerHadolintCommand;
	} else {
		console.error(
			"Dockerfile lint requires a local 'hadolint' binary or Docker with the official hadolint image.",
		);
		return 1;
	}
	for (const path of files) {
		const command = commandBuilder(path);
		const completed = spawnSync(command[0], command.slice(1), { cwd: repoRoot, stdio: "inherit" });
		if (completed.error) {
			throw completed.error;
		}
		if (completed.status !== 0) {
			return completed.status ?? 1;
		}
	}
	console.log(`Validated ${files.length} Dockerfiles from current worktree.`);
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
