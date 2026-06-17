import { describe, expect, it } from "vitest";

import { formatExternalHrefLabel, normalizeSafeExternalHref } from "../src/panel/panel-safe-links";

describe("Operator Console external links", () => {
	it("allows only http and https links to leave the Operator Console", () => {
		expect(normalizeSafeExternalHref("https://sentry.example/traces/trace_01")).toBe(
			"https://sentry.example/traces/trace_01",
		);
		expect(normalizeSafeExternalHref("http://localhost:3000/traces/trace_01")).toBe(
			"http://localhost:3000/traces/trace_01",
		);
		expect(normalizeSafeExternalHref("javascript:alert(1)")).toBeNull();
		expect(normalizeSafeExternalHref("data:text/html,<script>alert(1)</script>")).toBeNull();
		expect(normalizeSafeExternalHref("/internal/relative/path")).toBeNull();
		expect(normalizeSafeExternalHref("not a url")).toBeNull();
	});

	it("formats blocked external links without echoing unsafe href values", () => {
		expect(formatExternalHrefLabel("javascript:alert(1)")).toBe("不可用");
		expect(formatExternalHrefLabel("https://sentry.example/issues/123")).toBe(
			"https://sentry.example/issues/123",
		);
	});
});
