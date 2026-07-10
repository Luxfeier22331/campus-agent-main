import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export function trackedPnpmLockFiles(root = repoRoot): string[] {
	return worktreePaths(root, ["pnpm-lock.yaml", "**/pnpm-lock.yaml"]).filter((path) => {
		const relpath = relativePosix(root, path);
		const excluded =
			relpath.startsWith(".planning/") ||
			relpath.includes("/vendor/") ||
			relpath.includes("/node_modules/");
		return !excluded && existsSync(path);
	});
}

export function buildRootPnpmLockCheckCommand(): string[] {
	return ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--lockfile-only"];
}

export function appPackageManifestForLockfile(lockfile: string, root = repoRoot): string {
	const manifest = join(dirname(lockfile), "package.json");
	if (!existsSync(manifest)) {
		throw new Error(
			`app-local pnpm lockfile requires sibling package.json: ${relativePosix(root, lockfile)}`,
		);
	}
	return manifest;
}

export function validateAppManifestHasNoWorkspaceDependencies(
	manifest: Record<string, unknown>,
	manifestPath: string,
	root = repoRoot,
): void {
	const offenders: string[] = [];
	for (const section of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
		"peerDependencies",
	]) {
		const dependencies = manifest[section];
		if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
			continue;
		}
		for (const [name, specifier] of Object.entries(dependencies)) {
			if (String(specifier).trim().startsWith("workspace:")) {
				offenders.push(`${section}.${name}`);
			}
		}
	}
	if (offenders.length > 0) {
		throw new Error(
			`${relativePosix(root, manifestPath)} cannot use workspace protocol dependencies with an app-local pnpm-lock.yaml: ${offenders.sort().join(", ")}`,
		);
	}
}

export function validateAppManifestForLockfile(lockfile: string, root = repoRoot): void {
	const manifestPath = appPackageManifestForLockfile(lockfile, root);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error(`${relativePosix(root, manifestPath)} must be an object`);
	}
	validateAppManifestHasNoWorkspaceDependencies(
		manifest as Record<string, unknown>,
		manifestPath,
		root,
	);
}

export function buildAppPnpmLockCheckCommand(lockfile: string, root = repoRoot): string[] {
	const appDir = relativePosix(root, dirname(lockfile));
	return [
		"pnpm",
		"install",
		"--dir",
		appDir,
		"--ignore-workspace",
		"--lockfile-dir",
		appDir,
		"--frozen-lockfile",
		"--ignore-scripts",
		"--lockfile-only",
	];
}

export function validatePnpmLockfile(path: string, root = repoRoot): void {
	let command: string[];
	if (dirname(path) === root) {
		command = buildRootPnpmLockCheckCommand();
	} else {
		validateAppManifestForLockfile(path, root);
		command = buildAppPnpmLockCheckCommand(path, root);
	}
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
	const seen = new Set<string>();
	const paths: string[] = [];
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

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "pnpm-lock-policy-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	expectEqualJson(
		buildRootPnpmLockCheckCommand(),
		["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--lockfile-only"],
		"root pnpm lock command",
	);
	expectEqualJson(
		buildAppPnpmLockCheckCommand(join(repoRoot, "apps", "app-api", "pnpm-lock.yaml")),
		[
			"pnpm",
			"install",
			"--dir",
			"apps/app-api",
			"--ignore-workspace",
			"--lockfile-dir",
			"apps/app-api",
			"--frozen-lockfile",
			"--ignore-scripts",
			"--lockfile-only",
		],
		"app pnpm lock command",
	);
	withFixture((root) => {
		let failed = false;
		try {
			appPackageManifestForLockfile(join(root, "tmp", "missing", "pnpm-lock.yaml"), root);
		} catch (error) {
			failed = String(error).includes("package.json");
		}
		if (!failed) {
			throw new Error("missing package.json lockfile fixture should fail");
		}
		const manifest = join(root, "apps", "app-api", "package.json");
		mkdirSync(dirname(manifest), { recursive: true });
		writeFileSync(
			manifest,
			JSON.stringify({ dependencies: { "@campus-agent/dining": "workspace:*" } }),
		);
		failed = false;
		try {
			validateAppManifestForLockfile(join(root, "apps", "app-api", "pnpm-lock.yaml"), root);
		} catch (error) {
			failed = String(error).includes("workspace protocol");
		}
		if (!failed) {
			throw new Error("workspace protocol app-local lockfile fixture should fail");
		}
	});
	console.log("check_pnpm_lock_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures: string[] = [];
	for (const path of trackedPnpmLockFiles()) {
		try {
			validatePnpmLockfile(path);
		} catch (error) {
			failures.push(
				`${relativePosix(repoRoot, path)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (failures.length > 0) {
		console.error("pnpm lock integrity check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log(`Validated ${trackedPnpmLockFiles().length} pnpm lockfiles from current worktree.`);
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
