import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateJsonArtifactInvariants } from "../scripts/contracts/schema-invariants.ts";
import { checkContractSchemas } from "../scripts/contracts/schema-registry.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function readJson(path: string): Record<string, unknown> {
	const value = JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return value as Record<string, unknown>;
}

describe("contract schema registry", () => {
	it("validates registered schemas, runtime artifacts and fixtures", () => {
		expect(() => checkContractSchemas()).not.toThrow();
	});

	it("keeps model-visible runtime tool schemas on registered JSON Schema refs", () => {
		const registry = readJson("packages/contracts/schemas/contract-schema-registry.v1.json");
		const schemaIds = new Set(
			((registry.entries as Record<string, unknown>[] | undefined) ?? [])
				.map((entry) => entry.path)
				.filter((path): path is string => typeof path === "string" && path.endsWith(".schema.json"))
				.map((path) => readJson(path).$id)
				.filter((id): id is string => typeof id === "string"),
		);
		const tools = readJson("configs/runtime/tools.v4.json").tools as Record<string, unknown>[];

		for (const tool of tools) {
			for (const fieldName of ["payload_schema_ref", "result_schema_ref"]) {
				const ref = String(tool[fieldName]);
				const [schemaId, pointer] = ref.split("#");
				expect(
					ref,
					`${tool.name}.${fieldName} must not reference Python helper names`,
				).not.toContain("campus_contracts.");
				expect(schemaIds.has(schemaId), `${schemaId} must be registered`).toBe(true);
				expect(pointer, `${tool.name}.${fieldName} must target a $defs JSON pointer`).toMatch(
					/^\/\$defs\//u,
				);
			}
		}
	});

	it("rejects raw replay sections when the capture policy does not admit them", () => {
		const packet = readJson(
			"packages/contracts/fixtures/replay_capture/llm-replay-packet.v1.basic.valid.json",
		);
		packet.provider_response_body = { output: "not admitted by fixture policy" };

		expect(() =>
			validateJsonArtifactInvariants("llm-replay-packet.v1", "test-fixture.json", packet),
		).toThrow(/raw section is not admitted/u);
	});

	it("rejects raw provider credentials inside admitted replay sections", () => {
		const packet = readJson(
			"packages/contracts/fixtures/replay_capture/llm-replay-packet.v1.basic.valid.json",
		);
		packet.provider_request_body = { authorization_header: "Bearer forbidden" };

		expect(() =>
			validateJsonArtifactInvariants("llm-replay-packet.v1", "test-fixture.json", packet),
		).toThrow(/forbidden raw replay key/u);
	});
});
