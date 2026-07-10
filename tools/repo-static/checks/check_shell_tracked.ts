import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export function trackedShellFiles(root = repoRoot): string[] {
	return worktreePaths(root, ["*.sh"]);
}

export function selectAffectedShellFiles(paths: string[], root = repoRoot): string[] {
	const seen = new Set<string>();
	const selected: string[] = [];
	for (const path of paths) {
		const candidate = join(root, path);
		if (!(path.endsWith(".sh") && existsSync(candidate)) || seen.has(path)) {
			continue;
		}
		seen.add(path);
		selected.push(candidate);
	}
	return selected;
}

export function buildLocalShellcheckCommand(path: string, root = repoRoot): string[] {
	return ["shellcheck", "-x", "-s", "bash", pathRelativeTo(root, path)];
}

export function buildDockerShellcheckCommand(path: string, root = repoRoot): string[] {
	return [
		"docker",
		"run",
		"--rm",
		"-v",
		`${root}:/work`,
		"-w",
		"/work",
		"koalaman/shellcheck:stable",
		"-x",
		"-s",
		"bash",
		pathRelativeTo(root, path),
	];
}

export function resolveShellcheckCommandBuilder(): (path: string, root?: string) => string[] {
	if (commandExists("shellcheck")) {
		return buildLocalShellcheckCommand;
	}
	if (commandExists("docker")) {
		return buildDockerShellcheckCommand;
	}
	throw new Error(
		"Shell lint requires a local 'shellcheck' binary or Docker with the official shellcheck image.",
	);
}

export function validateShellFile(
	path: string,
	commandBuilder = resolveShellcheckCommandBuilder(),
	root = repoRoot,
): void {
	const command = commandBuilder(path, root);
	const result = spawnSync(command[0], command.slice(1), {
		cwd: root,
		encoding: "utf8",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error((result.stderr || result.stdout || "").trim());
	}
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

function pathRelativeTo(root: string, path: string): string {
	const normalized = path.startsWith(root) ? relative(root, path) : path;
	return normalized.replaceAll("\\", "/");
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	const root = mkdtempSync(join(tmpdir(), "shell-tracked-"));
	try {
		const script = join(root, "scripts", "example.sh");
		mkdirSync(dirname(script), { recursive: true });
		writeFileSync(script, "#!/usr/bin/env bash\nset -euo pipefail\n", "utf8");
		expectEqualJson(
			buildLocalShellcheckCommand(script, root),
			["shellcheck", "-x", "-s", "bash", "scripts/example.sh"],
			"local shellcheck command",
		);
		expectEqualJson(
			buildDockerShellcheckCommand(script, root),
			[
				"docker",
				"run",
				"--rm",
				"-v",
				`${root}:/work`,
				"-w",
				"/work",
				"koalaman/shellcheck:stable",
				"-x",
				"-s",
				"bash",
				"scripts/example.sh",
			],
			"docker shellcheck command",
		);
		if (selectAffectedShellFiles(["apps/campus-web/src/index.ts"], root).length > 0) {
			throw new Error("unrelated affected path should not select shell files");
		}
		const selected = selectAffectedShellFiles(["scripts/example.sh"], root);
		expectEqualJson(selected, [script], "affected shell selection");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	console.log("check_shell_tracked self-test passed.");
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
	const files = args.affected ? selectAffectedShellFiles(args.affected) : trackedShellFiles();
	if (files.length === 0) {
		console.log("No current-worktree shell files matched the requested pathspecs.");
		return 0;
	}
	let commandBuilder: (path: string, root?: string) => string[];
	try {
		commandBuilder = resolveShellcheckCommandBuilder();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
	const failures: string[] = [];
	for (const path of files) {
		try {
			validateShellFile(path, commandBuilder);
		} catch (error) {
			failures.push(
				`${pathRelativeTo(repoRoot, path)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (failures.length > 0) {
		console.error("Shell lint failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log(`Validated ${files.length} shell files from current worktree.`);
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
