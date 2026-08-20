import { describe, expect, it } from "vitest";

import { formatSafeErrorMessage } from "../src/safe-error.js";

describe("internal portal collection safe errors", () => {
	it("redacts portal cookies from HTTP request errors", () => {
		const message = [
			"portal request failed: getaddrinfo EAI_AGAIN portal.example.edu",
			"Request headers:",
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

	it("redacts CAS service tickets from redirect URLs", () => {
		const safe = formatSafeErrorMessage(
			"request failed at https://portal.example.edu/login?ticket=ST-secret&next=/notice",
		);

		expect(safe).not.toContain("ST-secret");
		expect(safe).toContain("ticket=<redacted>");
	});
});
