import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const publicAssetPatterns = [
	"apps/campus-web/public/assets/dining/reviews/**",
	"apps/campus-web/public/map-assets/**",
	"apps/campus-web/test/fixtures/**",
];
const textSuffixes = new Set([".geojson", ".json", ".ts"]);
const forbiddenSourceTokens = [
	"OpenStreetMap",
	"Open Database License",
	"ODbL",
	"muc.edu.cn",
	"中央民族大学",
	"849087992",
	"548820883",
	"365025448",
	"116.108483",
	"116.10859555",
	"116.3211",
	"116.3222",
];

export interface PublicAssetSourceCleanFailure {
	path: string;
	lineNumber: number;
	token: string;
}

export function publicAssetFiles(root = repoRoot): string[] {
	return candidateFiles(root, publicAssetPatterns).filter((path) => {
		const relativePath = relativePosix(root, path);
		return statSync(path).isFile() && relevantPublicAsset(relativePath, path);
	});
}

export function scanPublicAssetSourceTokens(root = repoRoot): PublicAssetSourceCleanFailure[] {
	const failures: PublicAssetSourceCleanFailure[] = [];
	for (const path of publicAssetFiles(root)) {
		const relativePath = relativePosix(root, path);
		if (relativePath.startsWith("apps/campus-web/public/assets/dining/reviews/")) {
			failures.push({
				path: relativePath,
				lineNumber: 0,
				token: "repo_public_dining_review_media",
			});
			continue;
		}
		if (relativePath.startsWith("apps/campus-web/public/map-assets/")) {
			failures.push({ path: relativePath, lineNumber: 0, token: "repo_public_map_asset" });
			continue;
		}
		if (!textSuffixes.has(extname(path).toLowerCase())) {
			continue;
		}
		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			for (const token of forbiddenSourceTokens) {
				if (line.includes(token)) {
					failures.push({ path: relativePath, lineNumber: index + 1, token });
				}
			}
		}
	}
	return failures;
}

function relevantPublicAsset(relativePath: string, path: string): boolean {
	return (
		relativePath.startsWith("apps/campus-web/public/assets/dining/reviews/") ||
		relativePath.startsWith("apps/campus-web/public/map-assets/") ||
		(relativePath.startsWith("apps/campus-web/test/fixtures/") &&
			textSuffixes.has(extname(path).toLowerCase()))
	);
}

function renderFailure(failure: PublicAssetSourceCleanFailure): string {
	if (failure.lineNumber === 0) {
		return `${failure.path}: forbidden public asset ${JSON.stringify(failure.token)}`;
	}
	return `${failure.path}: line ${failure.lineNumber}: forbidden source token ${JSON.stringify(failure.token)}`;
}

function candidateFiles(root: string, pathspecs: string[]): string[] {
	if (existsSync(join(root, ".git"))) {
		return worktreePaths(root, pathspecs);
	}
	return walkFiles(root);
}

function walkFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkFiles(path));
		} else if (entry.isFile()) {
			result.push(path);
		}
	}
	return result.sort();
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "public-asset-clean-"));
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

function writeBytes(path: string, bytes: Uint8Array): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		const assetPath = join(root, "apps", "campus-web", "public", "map-assets", "haidian.geojson");
		writeText(assetPath, '{"type":"FeatureCollection","features":[]}');
		expectEqualJson(
			scanPublicAssetSourceTokens(root),
			[
				{
					path: "apps/campus-web/public/map-assets/haidian.geojson",
					lineNumber: 0,
					token: "repo_public_map_asset",
				},
			],
			"map asset rejection",
		);
	});
	withFixture((root) => {
		const assetPath = join(
			root,
			"apps",
			"campus-web",
			"public",
			"assets",
			"dining",
			"reviews",
			"photo.jpg",
		);
		writeBytes(assetPath, new Uint8Array([1, 2, 3]));
		expectEqualJson(
			scanPublicAssetSourceTokens(root),
			[
				{
					path: "apps/campus-web/public/assets/dining/reviews/photo.jpg",
					lineNumber: 0,
					token: "repo_public_dining_review_media",
				},
			],
			"dining review media rejection",
		);
	});
	withFixture((root) => {
		const fixturePath = join(root, "apps", "campus-web", "test", "fixtures", "demo-map.geojson");
		writeText(
			fixturePath,
			'{"license":"OpenStreetMap data is available under the Open Database License"}',
		);
		const tokens = scanPublicAssetSourceTokens(root).map((failure) => failure.token);
		expectEqualJson(tokens, ["OpenStreetMap", "Open Database License"], "fixture token rejection");
	});
	const repoFiles = publicAssetFiles(repoRoot).map((path) => relativePosix(repoRoot, path));
	expect(
		repoFiles.includes("apps/campus-web/test/fixtures/map-manifest.ts"),
		"repo public asset discovery lost map fixture",
	);
	console.log("check_public_asset_source_clean self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = scanPublicAssetSourceTokens();
	if (failures.length > 0) {
		console.error("Public asset source-clean check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log(`Validated ${publicAssetFiles().length} public asset files.`);
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
