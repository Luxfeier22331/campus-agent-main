import { describe, expect, it } from "vitest";

import { assertLocalTestUserDatabaseUrl, LOCAL_TEST_USER } from "../ops/db/seed-local-test-user.ts";

describe("local test user seed", () => {
	it("uses the fixed development credentials", () => {
		expect(LOCAL_TEST_USER).toEqual({
			email: "test@muc.edu.cn",
			name: "本地测试用户",
			password: "password123",
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
});
