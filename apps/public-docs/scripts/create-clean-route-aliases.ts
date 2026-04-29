import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
const buildRoot = resolve(appRoot, "doc_build");

interface AliasResult {
	aliasPath: string;
	sourcePath: string;
}

function walkHtmlFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkHtmlFiles(path));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".html")) {
			files.push(path);
		}
	}
	return files;
}

function createCleanRouteAlias(htmlFile: string): AliasResult | null {
	if (basename(htmlFile) === "index.html") {
		return null;
	}
	const routeDir = htmlFile.slice(0, -".html".length);
	if (existsSync(routeDir) && !statSync(routeDir).isDirectory()) {
		throw new Error(`cannot create clean-route alias over non-directory path: ${routeDir}`);
	}
	rmSync(routeDir, { force: true, recursive: true });
	mkdirSync(routeDir, { recursive: true });
	const aliasPath = join(routeDir, "index.html");
	copyFileSync(htmlFile, aliasPath);
	return { aliasPath, sourcePath: htmlFile };
}

function main(): void {
	if (!existsSync(buildRoot)) {
		throw new Error(`missing public-docs build output: ${buildRoot}`);
	}
	const aliases = walkHtmlFiles(buildRoot)
		.map((htmlFile) => createCleanRouteAlias(htmlFile))
		.filter((alias): alias is AliasResult => alias !== null);

	console.log(
		`created ${aliases.length} clean-route aliases under ${relative(process.cwd(), buildRoot)}`,
	);
}

main();
