import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appChunkLimitBytes = 500 * 1024;
const allowedVendorBudgets = new Map([
	[
		"apps/campus-web",
		new Map([
			["vendor/maplibre-gl/maplibre-gl.js", Math.floor(1.3 * 1024 * 1024)],
			["vendor/maplibre-gl/maplibre-gl.css", 96 * 1024],
			["vendor/maplibre-gl/LICENSE.txt", 16 * 1024],
		]),
	],
]);

const requestedApps = parseRequestedApps(process.argv.slice(2));
const apps = requestedApps.length > 0 ? requestedApps : discoverBuiltApps();
const failures = [];

for (const app of apps) {
	checkApp(app, failures);
}

if (failures.length > 0) {
	console.error("Web client bundle budget check failed:");
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exitCode = 1;
} else {
	console.log(`Web client bundle budget check passed for ${apps.length} app(s).`);
}

function parseRequestedApps(args) {
	const apps = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--app") {
			const app = args[index + 1];
			if (!app) {
				throw new Error("--app requires a value");
			}
			apps.push(normalizeAppPath(app));
			index += 1;
			continue;
		}
		if (arg.startsWith("--app=")) {
			apps.push(normalizeAppPath(arg.slice("--app=".length)));
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return apps;
}

function discoverBuiltApps() {
	const appsDir = path.join(repoRoot, "apps");
	return fs
		.readdirSync(appsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `apps/${entry.name}`)
		.filter((app) => fs.existsSync(path.join(repoRoot, app, "dist/client")));
}

function checkApp(app, failures) {
	const clientDir = path.join(repoRoot, app, "dist/client");
	if (!fs.existsSync(clientDir)) {
		failures.push(`${app}: missing dist/client; run the app build before bundle:lint`);
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
					`${app}: assets/${fileName} is ${formatBytes(size)}, limit ${formatBytes(
						appChunkLimitBytes,
					)}`,
				);
			}
		}
	}

	checkVendorFiles(app, clientDir, failures);
}

function checkVendorFiles(app, clientDir, failures) {
	const vendorDir = path.join(clientDir, "vendor");
	const allowed = allowedVendorBudgets.get(app) ?? new Map();
	const seen = new Set();

	if (fs.existsSync(vendorDir)) {
		for (const vendorFile of walkFiles(vendorDir)) {
			const relativePath = toPosix(path.relative(clientDir, vendorFile));
			seen.add(relativePath);
			const limit = allowed.get(relativePath);
			if (!limit) {
				failures.push(`${app}: ${relativePath} is not registered as an allowed vendor asset`);
				continue;
			}
			const size = fs.statSync(vendorFile).size;
			if (size > limit) {
				failures.push(
					`${app}: ${relativePath} is ${formatBytes(size)}, limit ${formatBytes(limit)}`,
				);
			}
		}
	}

	for (const [relativePath] of allowed) {
		if (!seen.has(relativePath)) {
			failures.push(`${app}: missing registered vendor asset ${relativePath}`);
		}
	}
}

function* walkFiles(directory) {
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

function normalizeAppPath(app) {
	const normalized = toPosix(path.normalize(app));
	if (!normalized.startsWith("apps/")) {
		return `apps/${normalized}`;
	}
	return normalized;
}

function toPosix(value) {
	return value.split(path.sep).join("/");
}

function formatBytes(bytes) {
	return `${(bytes / 1024).toFixed(1)} KiB`;
}
