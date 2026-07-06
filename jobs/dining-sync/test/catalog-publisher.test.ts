import { readFileSync } from "node:fs";

import { createDevDiningOperationsState } from "@campus-agent/dining/domain";
import { describe, expect, it, vi } from "vitest";

import { PostgresDiningCatalogPublisher, type DiningCatalogPgClient } from "../src/catalog-publisher";

function createClient(rows: Array<Record<string, unknown>> = []): DiningCatalogPgClient & {
	queries: Array<{ sql: string; values?: unknown[] }>;
} {
	const queries: Array<{ sql: string; values?: unknown[] }> = [];
	return {
		connect: vi.fn(async () => undefined),
		end: vi.fn(async () => undefined),
		queries,
		query: vi.fn(async (sql: string, values?: unknown[]) => {
			queries.push({ sql, values });
			if (sql.includes('FROM "dining"."releases"')) {
				return { rows };
			}
			if (sql.includes('FROM "dining"."draft_versions"')) {
				return { rows: [] };
			}
			return { rows: [] };
		}),
	};
}

describe("dining catalog publisher", () => {
	it("refreshes a dev seed catalog without writing review projections or SVG bytes", async () => {
		const client = createClient();
		const publisher = new PostgresDiningCatalogPublisher({ createClient: () => client });

		await publisher.refreshCatalog(createDevDiningOperationsState());

		const sql = client.queries.map((query) => query.sql).join("\n");
		const payload = JSON.stringify(client.queries.map((query) => query.values));
		expect(sql).not.toContain("review_projections");
		expect(payload).toContain("floorplan:");
		expect(payload).not.toContain("floorplan_asset_id");
		expect(payload).not.toContain("sanitized_svg_markup");
		expect(sql).toContain('"dining"."release_latest_pointer"');
		expect(client.queries.at(-1)?.sql).toBe("COMMIT");
	});

	it("keeps dev seed import production-closed at the CLI boundary", () => {
		const cliSource = readFileSync("src/cli.ts", "utf8");

		expect(cliSource).toContain('command === "import-dev-seed"');
		expect(cliSource).toContain('config.appEnvironment === "production"');
		expect(cliSource).toContain("Refusing to import dining dev seed in production.");
	});

	it("exposes a catalog replay command that publishes from stored observations", () => {
		const cliSource = readFileSync("src/cli.ts", "utf8");

		expect(cliSource).toContain('command === "publish-catalog-from-observations"');
		expect(cliSource).toContain("listActiveFeishuCatalogObservations");
		expect(cliSource).toContain("publishCatalogFromObservations");
	});
});
