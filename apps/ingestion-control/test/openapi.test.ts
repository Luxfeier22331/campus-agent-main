import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { parse } from "yaml";

interface OpenApiDocument {
	components?: { responses?: Record<string, unknown> };
	paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
}

const document = parse(
	readFileSync(resolve(import.meta.dirname, "../openapi.yaml"), "utf8"),
) as OpenApiDocument;

describe("ingestion-control OpenAPI contract", () => {
	it("credential routes declare every runtime response status", () => {
		const expected = new Map([
			["GET /internal/ingestion/internal-portal/credentials", ["200", "400", "401", "503"]],
			[
				"POST /internal/ingestion/internal-portal/credentials",
				["201", "400", "401", "409", "422", "503"],
			],
			[
				"POST /internal/ingestion/internal-portal/credentials/resolve",
				["200", "400", "401", "503"],
			],
			[
				"PUT /internal/ingestion/internal-portal/credentials/{credentialId}",
				["200", "400", "401", "404", "409", "422", "428", "503"],
			],
			[
				"DELETE /internal/ingestion/internal-portal/credentials/{credentialId}",
				["204", "400", "401", "404", "409", "428", "503"],
			],
			[
				"POST /internal/ingestion/internal-portal/credentials/{credentialId}/validate",
				["200", "400", "401", "404", "422", "503"],
			],
			[
				"POST /internal/ingestion/internal-portal/credentials/{credentialId}/reveal",
				["200", "400", "401", "404", "503"],
			],
		]);

		for (const [operation, statuses] of expected) {
			const [method, path] = operation.split(" ") as [string, string];
			const route = document.paths?.[path]?.[method.toLowerCase()];
			assert.ok(route, operation);
			assert.deepEqual(Object.keys(route.responses ?? {}).sort(), [...statuses].sort(), operation);
		}
	});

	it("credential route references resolve to declared response components", () => {
		const paths = document.paths ?? {};
		const responseComponents = document.components?.responses ?? {};
		for (const [path, methods] of Object.entries(paths)) {
			if (!path.startsWith("/internal/ingestion/internal-portal/credentials")) {
				continue;
			}
			for (const [method, operation] of Object.entries(methods)) {
				for (const [status, response] of Object.entries(operation.responses ?? {})) {
					if (!response || typeof response !== "object" || !("$ref" in response)) {
						continue;
					}
					const reference = String((response as { $ref?: unknown }).$ref);
					assert.match(
						reference,
						/^#\/components\/responses\/[A-Za-z][A-Za-z0-9]*$/u,
						`${method.toUpperCase()} ${path} ${status}`,
					);
					const componentName = reference.split("/").at(-1);
					assert.ok(
						componentName && responseComponents[componentName],
						`${method.toUpperCase()} ${path} ${status} -> ${reference}`,
					);
				}
			}
		}
	});
});
