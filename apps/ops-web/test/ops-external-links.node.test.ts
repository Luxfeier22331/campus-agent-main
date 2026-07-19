// @vitest-environment node

import { describe, expect, it } from "vitest";
import { toSentryExternalLink } from "../src/server/ops-external-links";

describe("Ops external links", () => {
	it("builds a fixed HTTPS Sentry Trace Explorer link", () => {
		expect(
			toSentryExternalLink({
				sentry: "https://sentry.example.test/orgredirect/organizations/campus/traces/",
			}),
		).toEqual({
			href: "https://sentry.example.test/orgredirect/organizations/campus/traces/",
			isAvailable: true,
			label: "Sentry Trace Explorer",
			source: "SENTRY",
		});
	});

	it("rejects missing and non-HTTPS links", () => {
		expect(toSentryExternalLink(undefined)).toBeNull();
		expect(toSentryExternalLink({ sentry: "http://sentry.example.test" })).toBeNull();
	});
});
