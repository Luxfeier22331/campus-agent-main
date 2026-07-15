import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { NormalizedColumnSpec, NormalizedIndexSpec } from "./shared-db-script-types.ts";

export const APP_API_KNOWN_SCHEMAS = [
	"campus_services",
	"campus_services_ops",
	"chat",
	"dining",
	"docs",
	"identity",
	"observability",
	"profile",
	"provider_config",
	"runtime",
];
export const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptsDir, "../../..");
const drizzleRoot = join(appRoot, "drizzle");
export const metaRoot = join(drizzleRoot, "meta");

export function normalizePostgresIdentifier(identifier: string): string {
	let output = "";
	let bytes = 0;

	for (const char of identifier) {
		const charBytes = Buffer.byteLength(char, "utf8");
		if (bytes + charBytes > POSTGRES_IDENTIFIER_MAX_BYTES) {
			break;
		}
		output += char;
		bytes += charBytes;
	}

	return output;
}

export function normalizeColumnSpec(columnSpec: {
	default?: unknown;
	name: string;
	notNull?: boolean;
	primaryKey?: boolean;
	type: string;
}): NormalizedColumnSpec {
	return {
		defaultValue: "default" in columnSpec ? columnSpec.default : null,
		name: columnSpec.name,
		notNull: Boolean(columnSpec.notNull),
		primaryKey: Boolean(columnSpec.primaryKey),
		type: columnSpec.type,
	};
}

export function normalizeSnapshotIndexSpec(
	indexName: string,
	indexSpec: {
		columns?: Array<{ expression: string }>;
		isUnique?: boolean;
		method?: string;
	},
): NormalizedIndexSpec {
	return {
		columns: (indexSpec.columns ?? []).map((column) => column.expression),
		method: typeof indexSpec.method === "string" ? indexSpec.method.toLowerCase() : null,
		name: indexName,
		unique: Boolean(indexSpec.isUnique),
	};
}
