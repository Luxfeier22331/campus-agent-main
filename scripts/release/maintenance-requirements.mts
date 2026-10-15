import { readFile } from "node:fs/promises";

const FILE = "infra/k8s/topology/maintenance-requirements.json";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function readMaintenanceRequirements(root: string): Promise<string[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(`${root}/${FILE}`, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}
		throw new Error(`Invalid maintenance requirements ${FILE}`, { cause: error });
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		Object.keys(parsed).sort().join("\n") !== "requiredMigrations\nschemaVersion" ||
		(parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
		!Array.isArray((parsed as { requiredMigrations?: unknown }).requiredMigrations)
	) {
		throw new Error(`Invalid maintenance requirements ${FILE}`);
	}
	const requirements = (parsed as { requiredMigrations: unknown[] }).requiredMigrations;
	if (
		!requirements.every((id) => typeof id === "string" && ID.test(id)) ||
		new Set(requirements).size !== requirements.length
	) {
		throw new Error(`Invalid migration IDs in ${FILE}`);
	}
	return [...(requirements as string[])].sort();
}
