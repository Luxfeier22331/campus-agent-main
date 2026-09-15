import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	assertLocalTestUserDatabaseUrl,
	LOCAL_ADMIN_TEST_USER,
	LOCAL_TEST_USER,
} from "../ops/db/seed-local-test-user.ts";

const seedSource = readFileSync(
	resolve(import.meta.dirname, "../ops/db/seed-local-test-user.ts"),
	"utf8",
);

describe("local test user seed", () => {
	it("uses the fixed development credentials", () => {
		expect(LOCAL_TEST_USER).toEqual({
			email: "test@muc.edu.cn",
			name: "本地测试用户",
			password: "password123",
		});
		expect(LOCAL_ADMIN_TEST_USER).toEqual({
			email: "admin@muc.edu.cn",
			name: "admin",
			password: "admin123",
		});
	});

	it("only accepts an isolated worktree database on loopback", () => {
		expect(() =>
			assertLocalTestUserDatabaseUrl(
				"postgresql://campus_agent:password@127.0.0.1:5432/campus_agent_wt_7_81d2c2d4",
			),
		).not.toThrow();
		expect(() =>
			assertLocalTestUserDatabaseUrl(
				"postgresql://campus_agent:password@db.internal:5432/campus_agent_wt_7_81d2c2d4",
			),
		).toThrow(/isolated local database/u);
		expect(() =>
			assertLocalTestUserDatabaseUrl(
				"postgresql://campus_agent:password@127.0.0.1:5432/campus_agent",
			),
		).toThrow(/isolated local database/u);
	});

	it("seeds credential accounts with the Better Auth provider key", () => {
		expect(seedSource).toContain('set "accountId" = $1, "password" = $2');
		expect(seedSource).toContain(
			'("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")',
		);
		expect(seedSource).toContain("values ($1, $2, 'credential', $2, $3, now(), now())");
	});
});
