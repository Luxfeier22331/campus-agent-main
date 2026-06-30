import { describe, expect, it } from "vitest";

import {
	buildCollectorModeCommand,
	type CollectorEntrypointMode,
	resolveCollectorMode,
} from "../src/collector-entrypoint.js";

describe("authenticated notice collector entrypoint", () => {
	it("defaults to auth-check when no collector mode is configured", () => {
		expect(resolveCollectorMode({})).toBe("auth-check");
	});

	const commandCases: [CollectorEntrypointMode, string[]][] = [
		["auth-check", ["node", "apps/authenticated-notice-collector/dist/auth-check.js"]],
		["notice-export", ["node", "apps/authenticated-notice-collector/dist/bootstrap-export.js"]],
		[
			"file-release-export",
			["node", "apps/authenticated-notice-collector/dist/file-release-export.js"],
		],
		["visual-ref-audit", ["node", "apps/authenticated-notice-collector/dist/visual-ref-audit.js"]],
	];

	it.each(commandCases)("routes %s mode to the built collector entrypoint", (mode, command) => {
		expect(buildCollectorModeCommand(mode)).toEqual(command);
	});

	it("rejects unknown collector modes before running collector code", () => {
		expect(() =>
			resolveCollectorMode({
				AUTHENTICATED_NOTICE_COLLECTOR_MODE: "query-serving",
			}),
		).toThrow("AUTHENTICATED_NOTICE_COLLECTOR_MODE");
	});
});
