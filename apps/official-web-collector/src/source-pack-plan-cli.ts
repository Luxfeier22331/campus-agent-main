import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { normalizeCliArgs } from "./cli.ts";
import { buildSourcePackExecutionPlan } from "./source-pack-plan.ts";

export function sourcePackPlanMain(argv: string[] = process.argv.slice(2)): void {
	const { values } = parseArgs({
		args: normalizeCliArgs(argv),
		options: {
			"site-id": { type: "string" },
			"repo-root": { type: "string" },
			"config-root": { type: "string" },
			"source-pack-id": { type: "string" },
		},
		allowPositionals: false,
	});

	const siteId = values["site-id"];
	if (typeof siteId !== "string" || siteId.length === 0) {
		throw new Error("--site-id is required");
	}

	const plan = buildSourcePackExecutionPlan(siteId, {
		repoRoot: values["repo-root"],
		configRoot: values["config-root"],
		sourcePackId: values["source-pack-id"],
	});
	console.log(JSON.stringify(plan, null, 2));
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	sourcePackPlanMain();
}
