import { describe, expect, it } from "vitest";

import {
	buildCollectorModeCommand,
	type CollectorEntrypointMode,
	resolveCollectorMode,
} from "../src/collector-entrypoint";

describe("authenticated notice collector entrypoint", () => {
	it("defaults to auth-check when no collector mode is configured", () => {
		expect(resolveCollectorMode({})).toBe("auth-check");
	});

	const commandCases: [CollectorEntrypointMode, string[]][] = [
		["auth-check", ["pnpm", "--dir", "apps/authenticated-notice-collector", "auth:check"]],
		["notice-export", ["pnpm", "--dir", "apps/authenticated-notice-collector", "bootstrap:export"]],
		[
			"file-release-export",
			["pnpm", "--dir", "apps/authenticated-notice-collector", "file-release:export"],
		],
		[
			"visual-ref-audit",
			["pnpm", "--dir", "apps/authenticated-notice-collector", "visual-ref:audit"],
		],
	];

	it.each(commandCases)("routes %s mode to the repo-local package script", (mode, command) => {
		expect(buildCollectorModeCommand(mode)).toEqual(command);
	});

	it("rejects unknown collector modes before running package scripts", () => {
		expect(() =>
			resolveCollectorMode({
				AUTHENTICATED_NOTICE_COLLECTOR_MODE: "query-serving",
			}),
		).toThrow("AUTHENTICATED_NOTICE_COLLECTOR_MODE");
	});
});
