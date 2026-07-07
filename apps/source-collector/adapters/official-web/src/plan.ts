import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { normalizeCliArgs } from "./cli.ts";
import {
	buildOfficialWebCrawlPlan,
	type OfficialWebCrawlPlan,
	type OfficialWebRunIntent,
} from "./core/index.ts";

export interface CollectorPlanOptions {
	repoRoot?: string;
	configRoot?: string;
	crawlRunId?: string;
	runIntent?: OfficialWebRunIntent;
	now?: Date;
}

export function buildCollectorPlan(
	siteId: string,
	options: CollectorPlanOptions = {},
): OfficialWebCrawlPlan {
	return buildOfficialWebCrawlPlan(siteId, options);
}

export function main(argv: string[] = process.argv.slice(2)): void {
	const { values } = parseArgs({
		args: normalizeCliArgs(argv),
		options: {
			"site-id": { type: "string" },
			"repo-root": { type: "string" },
			"config-root": { type: "string" },
			"crawl-run-id": { type: "string" },
			"run-intent": { type: "string" },
		},
		allowPositionals: false,
	});

	const siteId = values["site-id"];
	if (typeof siteId !== "string" || siteId.length === 0) {
		throw new Error("--site-id is required");
	}

	const plan = buildCollectorPlan(siteId, {
		repoRoot: values["repo-root"],
		configRoot: values["config-root"],
		crawlRunId: values["crawl-run-id"],
		runIntent: values["run-intent"] as OfficialWebRunIntent | undefined,
	});
	console.log(JSON.stringify(plan, null, 2));
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	main();
}
