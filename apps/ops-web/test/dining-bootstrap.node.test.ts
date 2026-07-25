// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { bootstrapDiningDraft } from "../ops/db/bootstrap-dining";

describe("Dining map bootstrap", () => {
	it("initializes an empty draft exactly once", async () => {
		const insertValues: unknown[][] = [];
		const query = vi.fn(async (sql: string, values?: unknown[]) => {
			if (sql.startsWith("insert into") && values) {
				insertValues.push(values);
			}
			return {
				rowCount: sql.startsWith("insert into") ? 1 : 0,
				rows: sql.startsWith("insert into") ? [{ revision: 1 }] : [],
			};
		});

		await expect(
			bootstrapDiningDraft({ query }, new Date("2026-07-24T08:00:00.000Z")),
		).resolves.toEqual({ revision: 1, status: "initialized" });
		expect(insertValues[0]?.[0]).toEqual(expect.any(Object));
		expect(insertValues[0]?.[1]).toEqual(expect.stringMatching(/^sha256:/));
		expect(insertValues[0]?.[2]).toBe("2026-07-24T08:00:00.000Z");
		expect(insertValues[0]?.[3]).toBe("system:dining-bootstrap");
		expect(query).toHaveBeenLastCalledWith("commit");
	});

	it("does not overwrite an existing draft", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.startsWith("insert into")) {
				return { rowCount: 0, rows: [] };
			}
			if (sql.startsWith("select revision")) {
				return { rowCount: 1, rows: [{ revision: 7 }] };
			}
			return { rowCount: 0, rows: [] };
		});

		await expect(bootstrapDiningDraft({ query })).resolves.toEqual({
			revision: 7,
			status: "already_initialized",
		});
		expect(query.mock.calls.filter(([sql]) => String(sql).startsWith("insert into"))).toHaveLength(
			1,
		);
		expect(query).toHaveBeenLastCalledWith("commit");
	});

	it("rolls back an invalid existing row", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.startsWith("insert into")) {
				return { rowCount: 0, rows: [] };
			}
			if (sql.startsWith("select revision")) {
				return { rowCount: 1, rows: [{ revision: 0 }] };
			}
			return { rowCount: 0, rows: [] };
		});

		await expect(bootstrapDiningDraft({ query })).rejects.toThrow("invalid revision");
		expect(query).toHaveBeenLastCalledWith("rollback");
	});
});
