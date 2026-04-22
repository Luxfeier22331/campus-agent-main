import process from "node:process";
import { fileURLToPath } from "node:url";

export {
	buildExpectedTableSpecs,
	loadMigrationContext,
	loadMigrationJournal,
	loadSnapshot,
} from "./adopt-shared-database-context.mjs";
export {
	classifySharedDatabaseState,
	inspectSharedDatabase,
	makeInventory,
	readDatabaseInventory,
	validateInventoryAgainstExpectedTables,
} from "./adopt-shared-database-inventory.mjs";
export {
	buildAdoptionPlan,
	parseMigrationStatement,
} from "./adopt-shared-database-plan.mjs";
export {
	applyAdoptionPlan,
	formatPlan,
	parseArgs,
	runSharedDatabaseAdoption,
} from "./adopt-shared-database-runtime.mjs";
export {
	APP_API_KNOWN_SCHEMAS,
	APP_API_MIGRATIONS_SCHEMA,
	APP_API_MIGRATIONS_TABLE,
} from "./adopt-shared-database-shared.mjs";

import {
	formatPlan,
	parseArgs,
	runSharedDatabaseAdoption,
} from "./adopt-shared-database-runtime.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	runSharedDatabaseAdoption({ apply: args.apply })
		.then((result) => {
			const payload = {
				applied: result.applied,
				plan: {
					journalRowsToInsert: result.plan.journalRowsToInsert.length,
					mismatches: result.plan.mismatches,
					state: result.plan.state,
					statements: result.plan.statements.length,
				},
			};
			if (args.json) {
				console.log(
					JSON.stringify(
						{
							...payload,
							detailedPlan: JSON.parse(formatPlan(result.plan)),
						},
						null,
						2,
					),
				);
				return;
			}
			console.log(formatPlan(result.plan));
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
