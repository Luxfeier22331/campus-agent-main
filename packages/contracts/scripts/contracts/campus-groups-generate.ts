import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CampusGroupsCatalogSchema } from "../../src/campus-groups.ts";
import { relativePath, repoPath, repoRoot } from "./common.ts";

const schemaPath = repoPath("packages/contracts/schemas/campus-groups-catalog.v1.schema.json");

export function generateCampusGroupsContract({ check = false }: { check?: boolean } = {}): void {
	const generated = z.toJSONSchema(CampusGroupsCatalogSchema, { target: "draft-2020-12" });
	const content = formatGeneratedJson(
		`${JSON.stringify(
			{
				...generated,
				$id: "https://muc.wiki/campus-agent/schemas/campus-groups-catalog.v1.schema.json",
				title: "campus-agent campus groups catalog",
			},
			null,
			"\t",
		)}\n`,
	);
	if (check) {
		if (!existsSync(schemaPath) || readFileSync(schemaPath, "utf8") !== content) {
			throw new Error(
				`generated campus groups contract is out of sync: ${relativePath(schemaPath)}`,
			);
		}
		return;
	}
	writeFileSync(schemaPath, content, "utf8");
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

export function runCampusGroupsContractSelfTest(): void {
	const valid = CampusGroupsCatalogSchema.safeParse({
		schemaVersion: "campus-groups-catalog.v1",
		sections: [],
	});
	if (!valid.success) {
		throw new Error("campus groups contract rejected a valid catalog");
	}
	const invalid = CampusGroupsCatalogSchema.safeParse({
		...valid.data,
		sections: [
			{
				groups: [
					{
						id: "test",
						joinUrl: "https://example.test/not-qq",
						name: "测试群",
						qqGroupNumber: "12345",
						summary: "",
						tags: [],
					},
				],
				id: "test",
				name: "测试",
			},
		],
	});
	if (invalid.success) {
		throw new Error("campus groups contract accepted a non-QQ join URL");
	}
}
