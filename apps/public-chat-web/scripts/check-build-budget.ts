import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
	checkPublicChatBuildBudgetSnapshot,
	type PublicChatBuildAsset,
} from "../config/build-budget";

const APP_ROOT = resolve(import.meta.dirname, "..");

function main(): void {
	const clientDir = process.argv[2] ? resolve(process.argv[2]) : resolve(APP_ROOT, "dist/client");
	const result = checkPublicChatBuildBudgetSnapshot({
		assets: collectAssets(resolve(clientDir, "assets")),
		indexHtml: readFileSync(resolve(clientDir, "index.html"), "utf8"),
	});
	console.log(JSON.stringify(result, null, 2));
}

function collectAssets(assetsDir: string): PublicChatBuildAsset[] {
	return readdirSync(assetsDir)
		.filter((fileName) => fileName.endsWith(".js") || fileName.endsWith(".css"))
		.map((fileName) => ({
			byteLength: statSync(resolve(assetsDir, fileName)).size,
			fileName: `assets/${fileName}`,
		}));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
