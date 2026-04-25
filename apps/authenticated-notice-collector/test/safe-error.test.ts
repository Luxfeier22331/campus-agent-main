import { describe, expect, it } from "vitest";

import { formatSafeErrorMessage } from "../src/safe-error";

describe("authenticated notice collector safe errors", () => {
	it("redacts portal cookies from Playwright call logs", () => {
		const message = [
			"apiRequestContext.post: getaddrinfo EAI_AGAIN my.muc.edu.cn",
			"Call log:",
			"  - cookie: SSO_TGC=TGT-secret; JSESSIONID=session-secret; nginx=proxy-secret",
			"  - authorization: Bearer bearer-secret",
		].join("\n");

		const safe = formatSafeErrorMessage(new Error(message));

		expect(safe).toContain("cookie: <redacted>");
		expect(safe).toContain("authorization: Bearer <redacted>");
		expect(safe).not.toContain("TGT-secret");
		expect(safe).not.toContain("session-secret");
		expect(safe).not.toContain("proxy-secret");
		expect(safe).not.toContain("bearer-secret");
	});

	it("redacts cookie fragments outside formatted header lines", () => {
		const safe = formatSafeErrorMessage(
			"failed with SSO_TGC=TGT-secret; JSESSIONID=session-secret; nginx=proxy-secret",
		);

		expect(safe).not.toContain("TGT-secret");
		expect(safe).not.toContain("session-secret");
		expect(safe).not.toContain("proxy-secret");
		expect(safe).toContain("SSO_TGC=<redacted>");
		expect(safe).toContain("JSESSIONID=<redacted>");
		expect(safe).toContain("nginx=<redacted>");
	});
});
