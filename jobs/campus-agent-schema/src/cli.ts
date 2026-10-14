import { createMigration } from "./history.ts";
import { maintenance } from "./maintenance.ts";
import {
	inspectCampusAgentSchema,
	MEMORY_MIGRATIONS_FOLDER,
	MIGRATIONS_FOLDER,
	migrateCampusAgentSchema,
} from "./migrate.ts";

const raw = process.argv.slice(2);
const targetIndex = raw.indexOf("--target");
const target = targetIndex >= 0 ? raw.splice(targetIndex, 2)[1] : "campus-agent";
if (target !== "campus-agent" && target !== "memory") {
	throw new Error("--target must be campus-agent or memory");
}
const folder = target === "memory" ? MEMORY_MIGRATIONS_FOLDER : MIGRATIONS_FOLDER;
const [command, ...args] = raw;
if (command === "maintenance" && args.length === 1) {
	await maintenance(args[0]!);
} else if (command === "new" && args.length === 1 && args[0] !== undefined) {
	try {
		console.log(createMigration(folder, args[0]));
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
} else if ((command !== "migrate" && command !== "status") || args.length > 0) {
	console.error(
		"Usage: campus-agent-schema <migrate|status|maintenance phase|new name> [--target campus-agent|memory]",
	);
	process.exitCode = 1;
} else {
	try {
		console.log(
			JSON.stringify(
				command === "status"
					? await inspectCampusAgentSchema(process.env, folder, target)
					: await migrateCampusAgentSchema(process.env, folder, target),
			),
		);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
