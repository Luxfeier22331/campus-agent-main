import { readFileSync } from "node:fs";
import { validateIngestionTaskRegistry } from "ingestion-contracts";

import type { IngestionTaskRegistry } from "./types";

export function loadIngestionTaskRegistryFromFile(path: string): IngestionTaskRegistry {
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	const validation = validateIngestionTaskRegistry(payload);
	if (!validation.ok) {
		throw new Error(`invalid ingestion task registry: ${validation.errors.join("; ")}`);
	}
	return payload as IngestionTaskRegistry;
}
