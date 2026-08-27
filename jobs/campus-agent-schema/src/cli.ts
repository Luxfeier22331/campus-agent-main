import { migrateCampusAgentSchema } from "./migrate.ts";

const [command, ...args] = process.argv.slice(2);
if (command !== "migrate" || args.length > 0) {
	console.error("Usage: campus-agent-schema migrate");
	process.exitCode = 1;
} else {
	try {
		console.log(JSON.stringify(await migrateCampusAgentSchema()));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
