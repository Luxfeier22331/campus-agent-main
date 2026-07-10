import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appChunkLimitBytes = 500 * 1024;
const allowedVendorBudgets = new Map([
	["vendor/maplibre-gl/maplibre-gl.js", Math.floor(1.3 * 1024 * 1024)],
	["vendor/maplibre-gl/maplibre-gl.css", 96 * 1024],
	["vendor/maplibre-gl/LICENSE.txt", 16 * 1024],
]);

const failures: string[] = [];
checkClientBundle(failures);

if (failures.length > 0) {
	console.error("campus-web client bundle budget check failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exitCode = 1;
} else {
	console.log("campus-web client bundle budget check passed.");
}

function checkClientBundle(failures: string[]): void {
	const clientDir = path.join(appRoot, "dist/client");
	if (!fs.existsSync(clientDir)) {
		failures.push("missing dist/client; run the campus-web build before checking bundle budget");
		return;
	}

	const assetDir = path.join(clientDir, "assets");
	if (fs.existsSync(assetDir)) {
		for (const fileName of fs.readdirSync(assetDir)) {
			if (!fileName.endsWith(".js")) {
				continue;
			}
			const assetPath = path.join(assetDir, fileName);
			const size = fs.statSync(assetPath).size;
			if (size > appChunkLimitBytes) {
				failures.push(
					`assets/${fileName} is ${formatBytes(size)}, limit ${formatBytes(appChunkLimitBytes)}`,
				);
			}
		}
	}

	checkVendorFiles(clientDir, failures);
}

function checkVendorFiles(clientDir: string, failures: string[]): void {
	const vendorDir = path.join(clientDir, "vendor");
	const seen = new Set<string>();

	if (fs.existsSync(vendorDir)) {
		for (const vendorFile of walkFiles(vendorDir)) {
			const relativePath = toPosix(path.relative(clientDir, vendorFile));
			seen.add(relativePath);
			const limit = allowedVendorBudgets.get(relativePath);
			if (!limit) {
				failures.push(`${relativePath} is not registered as an allowed vendor asset`);
				continue;
			}
			const size = fs.statSync(vendorFile).size;
			if (size > limit) {
				failures.push(`${relativePath} is ${formatBytes(size)}, limit ${formatBytes(limit)}`);
			}
		}
	}

	for (const [relativePath] of allowedVendorBudgets) {
		if (!seen.has(relativePath)) {
			failures.push(`missing registered vendor asset ${relativePath}`);
		}
	}
}

function* walkFiles(directory: string): Generator<string> {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(entryPath);
			continue;
		}
		if (entry.isFile()) {
			yield entryPath;
		}
	}
}

function toPosix(value: string): string {
	return value.split(path.sep).join("/");
}

function formatBytes(bytes: number): string {
	return `${(bytes / 1024).toFixed(1)} KiB`;
}
