import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { APP_ROOT, REPO_ROOT } from "./shared";

export function loadPublicDocsEnv(): void {
	for (const path of [
		resolve(REPO_ROOT, ".env"),
		resolve(APP_ROOT, ".env"),
		resolve(APP_ROOT, ".dev.vars"),
	]) {
		if (!existsSync(path)) {
			continue;
		}
		process.loadEnvFile(path);
	}
}
