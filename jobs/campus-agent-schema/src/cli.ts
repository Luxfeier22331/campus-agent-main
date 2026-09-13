import { createMigration } from "./history.ts";
import {
	inspectCampusAgentSchema,
	MIGRATIONS_FOLDER,
	migrateCampusAgentSchema,
} from "./migrate.ts";

const [command, ...args] = process.argv.slice(2);
if (command === "new" && args.length === 1 && args[0] !== undefined) {
	try {
		console.log(createMigration(MIGRATIONS_FOLDER, args[0]));
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
} else if ((command !== "migrate" && command !== "status") || args.length > 0) {
	console.error("Usage: campus-agent-schema <migrate|status|new name>");
	process.exitCode = 1;
} else {
	try {
		console.log(
			JSON.stringify(
				command === "status" ? await inspectCampusAgentSchema() : await migrateCampusAgentSchema(),
			),
		);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
