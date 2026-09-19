import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
	diagnoseLocalDevInstances,
	formatProfileSummary,
	localInstanceDestroyPreview,
} from "./instance-resources";
import type { LocalDoctorScope } from "./lifecycle";
import {
	destroyLocalDevelopment,
	diagnoseLocalDevelopment,
	initializeLocalDevelopmentTarget,
	pruneLocalDevelopment,
} from "./lifecycle";
import { parseProductDataOptions } from "./product-data-options";
import { reconcileSharedInfrastructure } from "./shared-infrastructure";
import { LOCAL_DEV_TARGETS, type LocalDevTarget } from "./targets";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function main(): Promise<void> {
	const command = process.argv[2];
	const args = process.argv.slice(3);
	try {
		switch (command) {
			case "init":
				await initializeLocalDevelopmentTarget(repoRoot, readTarget(args), {
					repair: args.includes("--repair"),
					...parseProductDataOptions(args),
				});
				return;
			case "doctor": {
				const diagnosis = await diagnoseLocalDevelopment(
					repoRoot,
					readTarget(args),
					readScope(args),
				);
				console.log(JSON.stringify(diagnosis, null, 2));
				if (diagnosis.status !== "ready") {
					process.exitCode = 1;
				}
				return;
			}
			case "instances": {
				const instances = await diagnoseLocalDevInstances(repoRoot, {
					verify: args.includes("--verify"),
				});
				console.log(
					instances.length > 0
						? instances.map(formatInstanceDiagnosis).join("\n\n")
						: "No local development instances are registered.",
				);
				return;
			}
			case "shared-reconcile":
				await reconcileSharedInfrastructure(repoRoot);
				return;
			case "destroy": {
				const instanceId = readFlag(args, "--instance");
				const confirmation = readFlag(args, "--confirm");
				if (!(instanceId && confirmation)) {
					console.log(localInstanceDestroyPreview(repoRoot, instanceId));
					return;
				}
				await destroyLocalDevelopment({ confirmation, instanceId, repoRoot });
				return;
			}
			case "prune":
				await pruneLocalDevelopment({
					confirmation: readFlag(args, "--confirm"),
					instanceId: readFlag(args, "--instance"),
					repoRoot,
				});
				return;
			default:
				throw new Error("Usage: dev CLI <init|doctor|instances|shared-reconcile|destroy|prune>.");
		}
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}

function readFlag(values: string[], flag: string): string | undefined {
	const index = values.indexOf(flag);
	if (index < 0) {
		return undefined;
	}
	const value = values[index + 1]?.trim();
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

function readTarget(values: string[]): LocalDevTarget {
	const value = readFlag(values, "--target") ?? "core";
	if (!LOCAL_DEV_TARGETS.includes(value as LocalDevTarget)) {
		throw new Error(`Invalid init target: ${value}. Expected ${LOCAL_DEV_TARGETS.join(", ")}.`);
	}
	return value as LocalDevTarget;
}

function readScope(values: string[]): LocalDoctorScope {
	const value = readFlag(values, "--scope") ?? "config";
	if (value !== "config" && value !== "runtime" && value !== "shared" && value !== "data") {
		throw new Error("Invalid doctor scope. Expected config, runtime, shared, or data.");
	}
	return value;
}

function formatInstanceDiagnosis(
	instance: Awaited<ReturnType<typeof diagnoseLocalDevInstances>>[number],
): string {
	return [
		formatProfileSummary(instance.profile),
		`Worktree state: ${instance.worktree}`,
		`Database state: ${instance.database}`,
		`Derived bucket state: ${instance.bucket}`,
		`Temporal namespace state: ${instance.namespace}`,
		`Status: ${instance.status}`,
	].join("\n");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode ||= 1;
});
