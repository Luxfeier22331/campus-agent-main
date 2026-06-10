import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url)).replace(/[/\\]scripts$/u, "");
const sourceDir = join(appRoot, "doc_build");
const publicDir = join(appRoot, "public");

if (!existsSync(sourceDir)) {
	throw new Error(
		"Rspress docs build output is missing. Run pnpm docs:build from apps/campus-web.",
	);
}

for (const routeRoot of ["docs", "static"]) {
	const source = join(sourceDir, routeRoot);
	if (!existsSync(source)) {
		continue;
	}
	const target = join(publicDir, routeRoot);
	rmSync(target, { force: true, recursive: true });
	mkdirSync(target, { recursive: true });
	cpSync(source, target, { recursive: true });
}
