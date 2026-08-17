// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { on, poolConstructor } = vi.hoisted(() => {
	const on = vi.fn();
	return {
		on,
		poolConstructor: vi.fn(function Pool(config: unknown) {
			return { config, on };
		}),
	};
});

vi.mock("pg", () => ({ Pool: poolConstructor }));

import { createOpsWebDatabasePool } from "../src/server/database.ts";

describe("Ops Web application database pool", () => {
	beforeEach(() => {
		on.mockReset();
		poolConstructor.mockClear();
	});

	it("requires the runtime database URL", () => {
		expect(() => createOpsWebDatabasePool({ NODE_ENV: "test" })).toThrow(
			"OPS_WEB_DATABASE_URL is required.",
		);
		expect(poolConstructor).not.toHaveBeenCalled();
	});

	it("uses one bounded test pool and one error listener", () => {
		const pool = createOpsWebDatabasePool({
			NODE_ENV: "test",
			OPS_WEB_DATABASE_SSLMODE: "disable",
			OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@localhost/campus_agent",
		});

		expect(poolConstructor).toHaveBeenCalledWith({
			connectionString: "postgresql://ops_web:secret@localhost/campus_agent",
			connectionTimeoutMillis: 5_000,
			idleTimeoutMillis: 30_000,
			max: 1,
			ssl: false,
			statement_timeout: 10_000,
		});
		expect(on).toHaveBeenCalledOnce();
		expect(on).toHaveBeenCalledWith("error", expect.any(Function));
		expect(pool).toBe(poolConstructor.mock.results[0]?.value);
	});

	it("caps the application pool at four connections outside tests", () => {
		createOpsWebDatabasePool({
			DEPLOYMENT_ENVIRONMENT: "local",
			OPS_WEB_DATABASE_SSLMODE: "disable",
			OPS_WEB_DATABASE_URL: "postgresql://ops_web:secret@localhost/campus_agent",
		});

		expect(poolConstructor).toHaveBeenCalledWith(expect.objectContaining({ max: 4 }));
	});
});
