import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	diagnoseLocalDevInstances,
	formatProfileSummary,
	localInstanceDestroyPreview,
} from "./lifecycle/instance-resources";
import type { LocalDoctorScope } from "./lifecycle/lifecycle";
import {
	destroyLocalDevelopment,
	diagnoseLocalDevelopment,
	initializeLocalDevelopmentTarget,
	pruneLocalDevelopment,
} from "./lifecycle/lifecycle";
import { ensureLocalInfrastructure } from "./lifecycle/local-infrastructure";
import {
	importCredentials,
	initializeSchedule,
	prepareEnvironment,
	prepareInfrastructure,
	prepareSchema,
	seedModels,
} from "./lifecycle/operations";
import { ensureLocalDevProfile, loadLocalDevProfile } from "./lifecycle/profile";
import {
	LOCAL_DEV_TARGETS,
	type LocalDevTarget,
	type LocalModelConfigName,
	resolveLocalDevTargetPlan,
} from "./lifecycle/targets";
import { DATA_DOMAINS, type DataDomain, runDataOperation } from "./product-data/domains";
import { DEFAULT_CLUSTER_NAMESPACE } from "./product-data/product-data-options";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2).filter((arg) => arg !== "--");
	if (
		command === "init" &&
		args.some((arg) =>
			["--data", "--replace", "--context", "--namespace", "--notice-limit"].includes(
				arg.split("=")[0],
			),
		)
	) {
		throw new Error(
			"dev:init only prepares environments. Use pnpm dev:local -- data seed --domain <domain> or data sync --domain <domain> for data operations.",
		);
	}
	const parsed = parseArgs({
		args,
		allowPositionals: true,
		options: {
			target: { type: "string" },
			scope: { type: "string" },
			domain: { type: "string", multiple: true },
			name: { type: "string", multiple: true },
			service: { type: "string" },
			replace: { type: "boolean" },
			context: { type: "string" },
			namespace: { type: "string" },
			"with-sources": { type: "boolean" },
			"released-from": { type: "string" },
			"released-to": { type: "string" },
			instance: { type: "string" },
			confirm: { type: "string" },
			verify: { type: "boolean" },
		},
	});
	const domains = (): DataDomain[] => {
		const requested = parsed.values.domain ?? [];
		if (requested.length === 0) {
			throw new Error("Select --domain notices|groups|transport|dining|docs|retrieval.");
		}
		if (requested.includes("all")) {
			if (parsed.values.replace) {
				throw new Error("Replacement requires explicit domains; do not use --domain all.");
			}
			if (command === "data" && parsed.positionals[0] !== "seed") {
				throw new Error("--domain all is only supported by seed.");
			}
			return [...DATA_DOMAINS];
		}
		for (const value of requested) {
			if (!DATA_DOMAINS.includes(value as DataDomain)) {
				throw new Error(`Unknown data domain: ${value}`);
			}
		}
		return [...new Set(requested)] as DataDomain[];
	};
	try {
		switch (command) {
			case "init":
				await initializeLocalDevelopmentTarget(repoRoot, readTarget(parsed.values.target));
				return;
			case "env":
				prepareEnvironment(
					repoRoot,
					await ensureLocalDevProfile(repoRoot),
					readTarget(parsed.values.target),
				);
				return;
			case "infra":
				if (parsed.values.service) {
					if (parsed.values.service !== "hindsight") {
						throw new Error("Only hindsight has an independent provider-backed service operation.");
					}
					await ensureLocalInfrastructure(repoRoot, loadLocalDevProfile(repoRoot), ["hindsight"]);
				} else {
					await prepareInfrastructure(
						repoRoot,
						loadLocalDevProfile(repoRoot),
						readTarget(parsed.values.target),
					);
				}
				return;
			case "schema":
				await prepareSchema(repoRoot, loadLocalDevProfile(repoRoot));
				return;
			case "credentials":
				if (parsed.positionals.join(" ") !== "import") {
					throw new Error("Use credentials import --target <target>.");
				}
				importCredentials(repoRoot, readTarget(parsed.values.target));
				return;
			case "models": {
				if (parsed.positionals.join(" ") !== "seed") {
					throw new Error("Use models seed --target <target> or --name <config>.");
				}
				const valid = new Set(
					LOCAL_DEV_TARGETS.flatMap((target) => resolveLocalDevTargetPlan(target).modelConfigNames),
				);
				const names = parsed.values.name as LocalModelConfigName[] | undefined;
				for (const name of names ?? []) {
					if (!valid.has(name)) {
						throw new Error(`Unknown model configuration: ${name}`);
					}
				}
				await seedModels(
					repoRoot,
					loadLocalDevProfile(repoRoot),
					readTarget(parsed.values.target),
					names,
				);
				return;
			}
			case "schedule":
				if (parsed.positionals.join(" ") !== "init") {
					throw new Error("Use schedule init --target notice-pipeline-worker.");
				}
				initializeSchedule(
					repoRoot,
					loadLocalDevProfile(repoRoot),
					readTarget(parsed.values.target),
				);
				return;
			case "data": {
				const operation = parsed.positionals.join(" ");
				if (operation !== "seed" && operation !== "sync") {
					throw new Error("Use data seed --domain <domain> or data sync --domain <domain>.");
				}
				const selected = domains();
				if (
					operation === "seed" &&
					(parsed.values.context ||
						parsed.values.namespace ||
						parsed.values["with-sources"] ||
						parsed.values["released-from"] ||
						parsed.values["released-to"])
				) {
					throw new Error("Cluster options require data sync.");
				}
				if (
					(parsed.values["with-sources"] ||
						parsed.values["released-from"] ||
						parsed.values["released-to"]) &&
					!selected.includes("notices")
				) {
					throw new Error("Notice selection options require --domain notices.");
				}
				if (
					parsed.values.replace &&
					(parsed.values["released-from"] || parsed.values["released-to"])
				) {
					throw new Error("Notice date selection is an upsert operation; omit --replace.");
				}
				const noticeArgs = [
					...(["released-from", "released-to"] as const).flatMap((key) => {
						const value = parsed.values[key];
						return value ? [`--${key}`, value] : [];
					}),
					...(parsed.values["with-sources"] ? ["--with-sources"] : []),
				];
				await runDataOperation(repoRoot, loadLocalDevProfile(repoRoot), {
					operation,
					domains: selected,
					replace: parsed.values.replace ?? false,
					context: parsed.values.context,
					namespace: parsed.values.namespace ?? DEFAULT_CLUSTER_NAMESPACE,
					noticeArgs,
				});
				return;
			}
			case "doctor": {
				const diagnosis = await diagnoseLocalDevelopment(
					repoRoot,
					readTarget(parsed.values.target),
					readScope(parsed.values.scope),
					readScope(parsed.values.scope) === "data" ? domains() : [],
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
				throw new Error(
					"Usage: dev CLI <init|env|infra|schema|credentials|models|schedule|data|doctor|instances|destroy|prune>.",
				);
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

function readTarget(target: string | undefined): LocalDevTarget {
	const value = target ?? "core";
	if (!LOCAL_DEV_TARGETS.includes(value as LocalDevTarget)) {
		throw new Error(`Invalid init target: ${value}. Expected ${LOCAL_DEV_TARGETS.join(", ")}.`);
	}
	return value as LocalDevTarget;
}

function readScope(scope: string | undefined): LocalDoctorScope {
	const value = scope ?? "config";
	if (!["config", "runtime", "infra", "data", "schema", "startup"].includes(value)) {
		throw new Error(
			"Invalid doctor scope. Expected config, runtime, infra, schema, startup, or data.",
		);
	}
	return value as LocalDoctorScope;
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
