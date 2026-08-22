// @vitest-environment node

import { deriveLangfuseTraceId } from "@campus-agent/langfuse-identity";
import { describe, expect, it } from "vitest";
import {
	toLangfuseExternalLink,
	toSentryExternalLink,
	toTemporalExternalLink,
} from "../src/server/ops-external-links.ts";

describe("Ops external links", () => {
	it("links a product trace to its concrete Langfuse trace", async () => {
		const traceId = await deriveLangfuseTraceId("trace_0001");

		expect(
			await toLangfuseExternalLink("trace_0001", {
				langfuse: "https://langfuse.example.test/project/project-001?view=traces",
			}),
		).toEqual({
			href: `https://langfuse.example.test/project/project-001/traces/${traceId}`,
			isAvailable: true,
			label: "Langfuse Trace",
			source: "LANGFUSE",
		});
	});

	it("requires a complete HTTPS Langfuse project URL", async () => {
		await expect(
			toLangfuseExternalLink("trace_0001", { langfuse: "https://langfuse.example.test" }),
		).resolves.toBeNull();
		await expect(
			toLangfuseExternalLink("trace_0001", {
				langfuse: "http://langfuse.example.test/project/project-001",
			}),
		).resolves.toBeNull();
	});

	it("links Temporal to the persisted workflow id", () => {
		expect(
			toTemporalExternalLink("campus-agent.chat.run_001", {
				temporal: "https://temporal.example.test",
			}),
		).toMatchObject({
			href: "https://temporal.example.test/namespaces/default/workflows/campus-agent.chat.run_001",
			source: "TEMPORAL",
		});
	});

	it("keeps the configured Sentry link HTTPS-only", () => {
		expect(
			toSentryExternalLink({ sentry: "https://sentry.example.test/explore/traces" }),
		).toMatchObject({ source: "SENTRY" });
		expect(toSentryExternalLink({ sentry: "javascript:alert(1)" })).toBeNull();
	});
});
