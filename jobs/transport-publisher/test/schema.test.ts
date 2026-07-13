import type { FieldDef, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { TransportPublisherDatabaseClient } from "../src/postgres-publisher";
import { installCampusServicesSchema } from "../src/schema";

function emptyResult(): QueryResult {
	return { command: "", fields: [] as FieldDef[], oid: 0, rowCount: 0, rows: [] };
}

describe("installCampusServicesSchema", () => {
	it("installs tables and grants only the declared runtime roles", async () => {
		const statements: string[] = [];
		const client: TransportPublisherDatabaseClient = {
			connect: vi.fn(async () => undefined),
			end: vi.fn(async () => undefined),
			query: vi.fn(async (text: string) => {
				statements.push(text);
				return emptyResult();
			}),
		};

		await installCampusServicesSchema(
			{ connectionString: "postgres://unused", ssl: false },
			{ createClient: () => client },
		);

		expect(statements[0]).toBe("BEGIN");
		expect(statements[1]).toContain('CREATE SCHEMA IF NOT EXISTS "campus_services"');
		expect(statements[2]).toContain('TO "campus_services_publisher"');
		expect(statements[2]).toContain('TO "app_api"');
		expect(statements[2]).toContain('TO "execution_control"');
		expect(statements[2]).not.toContain('TO "execution_control", "ops_web"');
		expect(statements[2]).toContain(
			'REVOKE ALL ON ALL TABLES IN SCHEMA "campus_services"\nFROM "campus_services_publisher", "app_api", "execution_control", "ops_web"',
		);
		expect(statements[2]).not.toContain("campus_agent;");
		expect(statements.at(-1)).toBe("COMMIT");
	});
});
