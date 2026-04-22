import process from "node:process";
import { pathToFileURL } from "node:url";

export { parseCollectionRenameBackfillArgs } from "./collection-rename-backfill.args";
export { runCollectionRenameBackfill } from "./collection-rename-backfill.execution";
export {
	buildCollectionRenameBackfillPlan,
	resolveCollectionRename,
	resolveProjectionReplayEventType,
	rewriteResolvedScope,
	rewriteScopeSummary,
} from "./collection-rename-backfill.plan";
export { buildLocalCollectionRenameBackfillRuntime } from "./collection-rename-backfill.runtime";
export {
	COLLECTION_RENAME_MAP,
	type CollectionRenameBackfillApplyReport,
	type CollectionRenameBackfillArgs,
	type CollectionRenameBackfillAuditReport,
	type CollectionRenameBackfillPlan,
	type CollectionRenameBackfillPlanInput,
	type CollectionRenameBackfillReport,
	type CollectionRenameReplayReport,
} from "./collection-rename-backfill.shared";

import { parseCollectionRenameBackfillArgs } from "./collection-rename-backfill.args";
import { runCollectionRenameBackfill } from "./collection-rename-backfill.execution";
import { buildLocalCollectionRenameBackfillRuntime } from "./collection-rename-backfill.runtime";

async function main(argv: string[]) {
	const args = parseCollectionRenameBackfillArgs(argv);
	const runtime = buildLocalCollectionRenameBackfillRuntime(process.env);
	const report = await runCollectionRenameBackfill(runtime, args);
	console.log(JSON.stringify(report, null, 2));
}

const isEntrypoint =
	typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
	void main(process.argv.slice(2)).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
