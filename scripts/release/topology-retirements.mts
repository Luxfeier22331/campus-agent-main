import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { CommandRunner } from "../ci/scope.mts";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_PATTERN = /^ghcr\.io\/muc-wiki\/campus-agent\/[a-z0-9-]+$/;
const PATH_PATTERN = /^clusters\/staging\/overlays\/[a-z0-9-]+\/[a-zA-Z0-9._/-]+$/;
const KUSTOMIZATION_PATTERN = /\/kustomization\.yaml$/;
const MANIFEST_PATH = "infra/k8s/topology/retirements.json";

export type TopologyRetirementOperation =
	| { action: "remove-image"; path: string; image: string }
	| { action: "remove-resource"; path: string; resource: string }
	| { action: "remove-patch"; path: string; patch: string }
	| { action: "delete-file"; path: string };

export interface TopologyRetirement {
	id: string;
	operations: TopologyRetirementOperation[];
}

export interface TopologyRetirementsManifest {
	schemaVersion: 1;
	retirements: TopologyRetirement[];
}

export interface TopologyMigrationPlan {
	id: string;
	operations: TopologyRetirementOperation[];
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).sort().join("\n") === keys.slice().sort().join("\n");
}

function validateOperation(value: unknown, label: string): string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [`${label} must be an object`];
	}
	const operation = value as Record<string, unknown>;
	const failures: string[] = [];
	if (
		typeof operation.action !== "string" ||
		!["remove-image", "remove-resource", "remove-patch", "delete-file"].includes(operation.action)
	) {
		failures.push(`${label}.action is unsupported`);
	}
	if (
		typeof operation.path !== "string" ||
		!PATH_PATTERN.test(operation.path) ||
		operation.path.includes("..")
	) {
		failures.push(`${label}.path must target a staging overlay file`);
	}
	if (
		operation.action === "remove-image" &&
		(!exactKeys(operation, ["action", "image", "path"]) ||
			typeof operation.image !== "string" ||
			!IMAGE_PATTERN.test(operation.image) ||
			!KUSTOMIZATION_PATTERN.test(String(operation.path)))
	) {
		failures.push(`${label} must be a valid kustomization image removal`);
	}
	if (
		operation.action === "remove-resource" &&
		(!exactKeys(operation, ["action", "path", "resource"]) ||
			typeof operation.resource !== "string" ||
			!operation.resource ||
			operation.resource.includes("..") ||
			!KUSTOMIZATION_PATTERN.test(String(operation.path)))
	) {
		failures.push(`${label} must be a valid kustomization resource removal`);
	}
	if (
		operation.action === "remove-patch" &&
		(!exactKeys(operation, ["action", "patch", "path"]) ||
			typeof operation.patch !== "string" ||
			!operation.patch ||
			operation.patch.includes("..") ||
			!KUSTOMIZATION_PATTERN.test(String(operation.path)))
	) {
		failures.push(`${label} must be a valid kustomization patch removal`);
	}
	if (operation.action === "delete-file" && !exactKeys(operation, ["action", "path"])) {
		failures.push(`${label} must be a valid file deletion`);
	}
	return failures;
}

export function validateTopologyRetirements(value: unknown, file = MANIFEST_PATH): string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [`${file} must be an object`];
	}
	const manifest = value as Record<string, unknown>;
	const failures: string[] = [];
	if (!exactKeys(manifest, ["retirements", "schemaVersion"]) || manifest.schemaVersion !== 1) {
		failures.push(`${file} must contain schemaVersion 1 and retirements`);
	}
	if (!Array.isArray(manifest.retirements)) {
		return [...failures, `${file}.retirements must be an array`];
	}
	const ids = new Set<string>();
	for (const [index, raw] of manifest.retirements.entries()) {
		const label = `${file}.retirements[${index}]`;
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			failures.push(`${label} must be an object`);
			continue;
		}
		const retirement = raw as Record<string, unknown>;
		if (
			!exactKeys(retirement, ["id", "operations"]) ||
			typeof retirement.id !== "string" ||
			!ID_PATTERN.test(retirement.id)
		) {
			failures.push(`${label} must contain a valid id and operations`);
		}
		if (typeof retirement.id === "string" && ids.has(retirement.id)) {
			failures.push(`${label}.id is duplicated`);
		}
		if (typeof retirement.id === "string") {
			ids.add(retirement.id);
		}
		if (!Array.isArray(retirement.operations) || retirement.operations.length === 0) {
			failures.push(`${label}.operations must be non-empty`);
			continue;
		}
		const operations = new Set<string>();
		for (const [operationIndex, operation] of retirement.operations.entries()) {
			failures.push(...validateOperation(operation, `${label}.operations[${operationIndex}]`));
			const key = JSON.stringify(operation);
			if (operations.has(key)) {
				failures.push(`${label}.operations[${operationIndex}] is duplicated`);
			}
			operations.add(key);
		}
	}
	return failures;
}

function parseManifest(source: string, file: string): TopologyRetirementsManifest {
	let value: unknown;
	try {
		value = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(`Invalid topology retirements manifest ${file}`, { cause: error });
	}
	const failures = validateTopologyRetirements(value, file);
	if (failures.length > 0) {
		throw new Error(failures.join("\n"));
	}
	return value as TopologyRetirementsManifest;
}

async function manifestAt(
	root: string,
	revision: string,
	runner?: CommandRunner,
): Promise<TopologyRetirementsManifest> {
	if (runner) {
		const result = runner("git", ["show", `${revision}:${MANIFEST_PATH}`], {
			cwd: root,
			env: process.env,
		});
		if (result.status !== 0) {
			return { schemaVersion: 1, retirements: [] };
		}
		return parseManifest(result.stdout ?? "", `${revision}:${MANIFEST_PATH}`);
	}
	try {
		const source = execFileSync("git", ["show", `${revision}:${MANIFEST_PATH}`], {
			cwd: root,
			encoding: "utf8",
		});
		return parseManifest(source, `${revision}:${MANIFEST_PATH}`);
	} catch {
		return { schemaVersion: 1, retirements: [] };
	}
}

export async function readTopologyRetirements(
	root: string,
	base: string,
	runner?: CommandRunner,
): Promise<TopologyMigrationPlan[]> {
	let currentSource: string;
	try {
		currentSource = await readFile(`${root}/${MANIFEST_PATH}`, "utf8");
	} catch {
		return [];
	}
	const current = parseManifest(currentSource, MANIFEST_PATH);
	const previous = await manifestAt(root, base, runner);
	const previousIds = new Set(previous.retirements.map((retirement) => retirement.id));
	return current.retirements
		.filter((retirement) => !previousIds.has(retirement.id))
		.map((retirement) => ({ id: retirement.id, operations: retirement.operations }))
		.sort((left, right) => left.id.localeCompare(right.id));
}

export { MANIFEST_PATH };
