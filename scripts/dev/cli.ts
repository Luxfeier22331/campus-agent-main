import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
	destroyLocalDevelopment,
	diagnoseLocalDevelopment,
	formatProfileSummary,
	initializeLocalDevelopment,
	localInstanceDestroyPreview,
} from "./lifecycle";
import { listLocalDevProfiles } from "./profile";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const command = process.argv[2];
const args = process.argv.slice(3);

try {
	switch (command) {
		case "init":
			initializeLocalDevelopment(repoRoot);
			break;
		case "doctor": {
			const diagnosis = diagnoseLocalDevelopment(repoRoot);
			console.log(JSON.stringify(diagnosis, null, 2));
			if (
				!(
					diagnosis.bucketExists &&
					diagnosis.databaseExists &&
					diagnosis.managedEnvironmentReady &&
					diagnosis.sharedInfrastructureReady
				)
			) {
				process.exitCode = 1;
			}
			break;
		}
		case "instances": {
			const profiles = listLocalDevProfiles(repoRoot);
			console.log(
				profiles.length > 0
					? profiles.map((profile) => formatProfileSummary(profile)).join("\n\n")
					: "No local development instances are registered.",
			);
			break;
		}
		case "destroy": {
			const instanceId = readFlag(args, "--instance");
			const confirmation = readFlag(args, "--confirm");
			if (!(instanceId && confirmation)) {
				console.log(localInstanceDestroyPreview(repoRoot, instanceId));
				break;
			}
			destroyLocalDevelopment({ confirmation, instanceId, repoRoot });
			break;
		}
		default:
			throw new Error("Usage: dev CLI <init|doctor|instances|destroy>.");
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}

function readFlag(values: string[], flag: string): string | undefined {
	const index = values.indexOf(flag);
	return index >= 0 ? values[index + 1]?.trim() || undefined : undefined;
}
