import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
	PRODUCT_AVAILABILITY_SCHEMA_VERSION,
	ProductAvailabilitySnapshotSchema,
} from "../../src/product-availability.ts";
import { relativePath, repoPath, repoRoot } from "./common.ts";

const schemaPath = repoPath(
	"packages/contracts/schemas/product-availability-snapshot.v1.schema.json",
);

export function generateProductAvailabilityContract({ check = false }: { check?: boolean } = {}) {
	const generated = z.toJSONSchema(ProductAvailabilitySnapshotSchema, { target: "draft-2020-12" });
	const content = formatGeneratedJson(
		`${JSON.stringify(
			{
				...generated,
				$id: "https://muc.wiki/campus-agent/schemas/product-availability-snapshot.v1.schema.json",
				title: `campus-agent ${PRODUCT_AVAILABILITY_SCHEMA_VERSION}`,
			},
			null,
			"\t",
		)}\n`,
	);
	if (check) {
		if (!existsSync(schemaPath) || readFileSync(schemaPath, "utf8") !== content) {
			throw new Error(
				`generated product availability contract is out of sync: ${relativePath(schemaPath)}`,
			);
		}
		return;
	}
	writeFileSync(schemaPath, content, "utf8");
}

export function runProductAvailabilityContractSelfTest(): void {
	const valid = ProductAvailabilitySnapshotSchema.safeParse({
		environment: "staging",
		expiresAt: "2026-08-07T00:15:00Z",
		generatedAt: "2026-08-07T00:05:00Z",
		schemaVersion: PRODUCT_AVAILABILITY_SCHEMA_VERSION,
		services: [
			{
				checkedAt: "2026-08-07T00:05:00Z",
				id: "campus.qa",
				name: "校园问答",
				status: "operational",
				timeline: [{ day: "2026-08-07", status: "operational" }],
			},
			{
				checkedAt: "2026-08-07T00:05:00Z",
				id: "campus.services",
				name: "其他服务",
				status: "operational",
				timeline: [{ day: "2026-08-07", status: "operational" }],
			},
		],
	});
	if (!valid.success) {
		throw new Error("product availability contract rejected a valid snapshot");
	}
	const invalid = ProductAvailabilitySnapshotSchema.safeParse({
		...valid.data,
		services: [{ ...valid.data.services[0], status: "maintenance" }, valid.data.services[1]],
	});
	if (invalid.success) {
		throw new Error("product availability contract accepted an unsupported status");
	}
}

function formatGeneratedJson(content: string): string {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	const result = spawnSync(
		pnpm,
		["exec", "biome", "format", "--colors=off", "--stdin-file-path", schemaPath],
		{
			cwd: repoRoot,
			encoding: "utf8",
			input: content,
		},
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`unable to format ${relativePath(schemaPath)}: ${result.stderr.trim()}`);
	}
	return result.stdout;
}
