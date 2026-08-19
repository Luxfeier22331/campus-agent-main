import { describe, expect, it } from "vitest";
import { bootstrapIngestionControlSchema } from "../src/schema-bootstrap";

describe("bootstrapIngestionControlSchema", () => {
	it("creates and locks down the fixed schema before granting the runtime role", async () => {
		const calls: string[] = [];
		await bootstrapIngestionControlSchema({
			async query(sql) {
				calls.push(sql);
			},
		});

		expect(calls).toEqual([
			"CREATE SCHEMA IF NOT EXISTS ingestion_control",
			"ALTER SCHEMA ingestion_control OWNER TO CURRENT_USER",
			"REVOKE ALL ON SCHEMA ingestion_control FROM PUBLIC",
			"REVOKE ALL ON SCHEMA ingestion_control FROM ingestion_control",
			"GRANT USAGE ON SCHEMA ingestion_control TO ingestion_control",
		]);
	});
});
