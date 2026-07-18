import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export default async function globalSetup() {
	if (process.env.CAMPUS_WEB_E2E_DOCS_PREBUILT === "1") {
		for (const path of ["public/docs", "public/_docs-static"]) {
			if (!existsSync(resolve(path))) {
				throw new Error(`prebuilt Campus Web docs are missing: ${path}`);
			}
		}
		return;
	}
	execFileSync("pnpm", ["run", "build:docs:fixture"], {
		stdio: "inherit",
	});
}
