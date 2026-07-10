import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const forbiddenLicenseTokens = ["AGPL", "Affero", "Commons Clause", "SSPL"];
const lockfilePaths = ["pnpm-lock.yaml", "uv.lock", "apps/execution-control/go.sum", "Cargo.lock"];

export interface DependencyLicensePolicyFailure {
	path: string;
	token: string;
}

export function auditDependencyLicensePolicy(root = repoRoot): DependencyLicensePolicyFailure[] {
	const failures: DependencyLicensePolicyFailure[] = [];
	for (const relativePath of lockfilePaths) {
		const path = join(root, relativePath);
		if (!existsSync(path)) {
			continue;
		}
		const text = readFileSync(path, "utf8");
		for (const token of forbiddenLicenseTokens) {
			if (text.includes(token)) {
				failures.push({ path: relativePath, token });
			}
		}
	}
	return failures;
}

function renderFailure(failure: DependencyLicensePolicyFailure): string {
	return `${failure.path}: forbidden dependency license token ${JSON.stringify(failure.token)}`;
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "dependency-license-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		writeText(join(root, "pnpm-lock.yaml"), "license: AGPL-3.0-only\n");
		expectEqualJson(
			auditDependencyLicensePolicy(root),
			[{ path: "pnpm-lock.yaml", token: "AGPL" }],
			"forbidden license token",
		);
	});
	console.log("check_dependency_license_policy self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = auditDependencyLicensePolicy();
	if (failures.length > 0) {
		console.error("Dependency license policy check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log("Validated dependency lockfiles against forbidden license tokens.");
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
