import { describe, expect, it } from "vitest";

import { formatNoticeJobError, noticeJobErrorCode } from "../src/job-error.ts";

describe("notice Job errors", () => {
	it.each([
		["dns_resolution_failed", { cause: { code: "ENOTFOUND" } }],
		["connection_refused", Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" })],
		["network_timeout", new Error("request failed: UND_ERR_CONNECT_TIMEOUT")],
	] as const)("classifies %s without depending on a provider error type", (expected, error) => {
		expect(noticeJobErrorCode(error)).toBe(expected);
	});

	it("logs only a stable code and message", () => {
		const error = new Error("Bearer secret-token request failed");
		error.stack = "secret stack";

		expect(formatNoticeJobError(error)).toBe(
			'{"error_code":"job_failed","message":"Notice job failed."}',
		);
		expect(formatNoticeJobError(error)).not.toContain("secret");
	});
});
