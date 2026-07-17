import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertDocsReleaseId,
	docsReleaseDigest,
	docsReleaseManifestKey,
} from "../src/docs-reader-build/docs-release.ts";
import { createS3ObjectStore } from "../src/docs-reader-build/published-reader-object-store.ts";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsEnv = {
	...process.env,
	CAMPUS_WEB_RSPRESS_DOCS_ROOT: ".generated/docs",
};

interface BuildPublishedReaderDocsArgs {
	fixture: boolean;
	releaseId?: string;
}

export function parseBuildPublishedReaderDocsArgs(argv: string[]): BuildPublishedReaderDocsArgs {
	const parsed: BuildPublishedReaderDocsArgs = { fixture: false };
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--fixture") {
			parsed.fixture = true;
			continue;
		}
		if (token === "--release-id") {
			const value = argv[index + 1]?.trim();
			if (!value || value.startsWith("--")) {
				throw new Error(`${token} requires a value.`);
			}
			parsed.releaseId = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown docs build argument: ${token}`);
	}
	if (parsed.fixture && parsed.releaseId) {
		throw new Error("--fixture cannot be combined with --release-id.");
	}
	if (!parsed.fixture) {
		assertDocsReleaseId(parsed.releaseId ?? "");
	}
	return parsed;
}

export function assertManifestSha256(manifestPath: string, expectedSha256: string): void {
	assertManifestBytesSha256(readFileSync(manifestPath), expectedSha256);
}

export function assertManifestBytesSha256(manifestBytes: Uint8Array, expectedSha256: string): void {
	const actualSha256 = createHash("sha256").update(manifestBytes).digest("hex");
	if (actualSha256 !== expectedSha256) {
		throw new Error(
			`docs reader manifest SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`,
		);
	}
}

export async function buildPublishedReaderDocs(args: BuildPublishedReaderDocsArgs): Promise<void> {
	if (args.fixture) {
		run("pnpm", ["exec", "tsx", "./scripts/prepare-docs-build-fixture.ts"]);
	} else {
		const releaseId = assertDocsReleaseId(args.releaseId ?? "");
		const manifestSource = await resolveManifestSource(releaseId);
		try {
			run("pnpm", [
				"exec",
				"tsx",
				"./src/docs-reader-build/sync-campus-published-reader.ts",
				"all",
				"--manifest-path",
				manifestSource.path,
			]);
		} finally {
			manifestSource.cleanup();
		}
	}

	mirrorPublishedReaderAssetsForRspressBuild();
	run("pnpm", ["exec", "rspress", "build", "-c", "rspress.config.ts"]);
	run("pnpm", ["exec", "tsx", "./src/docs-reader-build/filter-rspress-search-index.ts"]);
	run("pnpm", ["exec", "tsx", "./src/docs-reader-build/copy-rspress-docs-build.ts"]);
}

async function resolveManifestSource(
	releaseId: string,
): Promise<{ cleanup: () => void; path: string }> {
	const manifestKey = docsReleaseManifestKey(releaseId);
	const manifestBytes = await createS3ObjectStore().readOptionalBytesObject({ key: manifestKey });
	if (!manifestBytes) {
		throw new Error(`missing docs reader release manifest object: ${manifestKey}`);
	}
	assertManifestBytesSha256(manifestBytes, docsReleaseDigest(releaseId));
	return materializeManifestBytes(manifestBytes);
}

function materializeManifestBytes(manifestBytes: Uint8Array): {
	cleanup: () => void;
	path: string;
} {
	const temporaryRoot = mkdtempSync(join(tmpdir(), "campus-docs-release-"));
	const manifestPath = join(temporaryRoot, "manifest.json");
	try {
		writeFileSync(manifestPath, manifestBytes, { mode: 0o600 });
	} catch (error) {
		rmSync(temporaryRoot, { force: true, recursive: true });
		throw error;
	}
	return {
		cleanup: () => rmSync(temporaryRoot, { force: true, recursive: true }),
		path: manifestPath,
	};
}

function run(command: string, commandArgs: string[]): void {
	const result = spawnSync(command, commandArgs, {
		cwd: appDir,
		env: docsEnv,
		stdio: "inherit",
	});
	if (result.status === 0) {
		return;
	}
	throw result.error ?? new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
}

function mirrorPublishedReaderAssetsForRspressBuild(): void {
	const sourcePublicRoot = resolve(appDir, "public");
	const docsPublicRoot = resolve(appDir, ".generated/docs/public");
	for (const routeRoot of ["_docs", "_gated-docs", "_gated-docs-search"]) {
		const source = resolve(sourcePublicRoot, routeRoot);
		const target = resolve(docsPublicRoot, routeRoot);
		rmSync(target, { force: true, recursive: true });
		if (!existsSync(source)) {
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, { recursive: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	buildPublishedReaderDocs(parseBuildPublishedReaderDocsArgs(process.argv.slice(2))).catch(
		(error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		},
	);
}
