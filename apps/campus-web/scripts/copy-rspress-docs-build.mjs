import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_STATIC_ROUTE_ROOT = "_docs-static";
const GENERIC_STATIC_REFERENCE = /["'(=]\s*\/static\//u;
const RSPRESS_RUNTIME_ROUTE_ROOTS = [
	"assets",
	"css",
	"font",
	"image",
	"js",
	"media",
	"static",
	"svg",
	"wasm",
];

const appRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/u, "");
const sourceDir = join(appRoot, "doc_build");
const publicDir = join(appRoot, "public");

export function assertRspressDocsStaticNamespace(buildRoot) {
	const jsDir = join(buildRoot, "js");
	if (!existsSync(jsDir)) {
		throw new Error(`Rspress docs JavaScript assets are missing under: ${jsDir}`);
	}

	for (const filePath of collectTextFiles(buildRoot)) {
		const content = readFileSync(filePath, "utf8");
		if (GENERIC_STATIC_REFERENCE.test(content)) {
			throw new Error(`Rspress docs build still references generic /static namespace: ${filePath}`);
		}
	}
}

function collectTextFiles(root) {
	if (!existsSync(root)) {
		return [];
	}
	const files = [];
	for (const entryName of readdirSync(root)) {
		const entryPath = join(root, entryName);
		const stat = statSync(entryPath);
		if (stat.isDirectory()) {
			files.push(...collectTextFiles(entryPath));
			continue;
		}
		if (/\.(css|html|js|json|map|txt)$/u.test(entryName)) {
			files.push(entryPath);
		}
	}
	return files;
}

export function copyRspressDocsBuild() {
	if (!existsSync(sourceDir)) {
		throw new Error(
			"Rspress docs build output is missing. Run pnpm docs:build from apps/campus-web.",
		);
	}

	assertRspressDocsStaticNamespace(sourceDir);
	rmSync(join(publicDir, "static"), { force: true, recursive: true });
	rmSync(join(publicDir, DOCS_STATIC_ROUTE_ROOT), { force: true, recursive: true });

	for (const routeRoot of ["docs"]) {
		const source = join(sourceDir, routeRoot);
		if (!existsSync(source)) {
			continue;
		}
		const target = join(publicDir, routeRoot);
		rmSync(target, { force: true, recursive: true });
		mkdirSync(target, { recursive: true });
		cpSync(source, target, { recursive: true });
	}

	const docsStaticTarget = join(publicDir, DOCS_STATIC_ROUTE_ROOT);
	mkdirSync(docsStaticTarget, { recursive: true });
	for (const routeRoot of RSPRESS_RUNTIME_ROUTE_ROOTS) {
		const source = join(sourceDir, routeRoot);
		if (!existsSync(source)) {
			continue;
		}
		const target = join(docsStaticTarget, routeRoot);
		mkdirSync(target, { recursive: true });
		cpSync(source, target, { recursive: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		copyRspressDocsBuild();
	} catch (error) {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	}
}
