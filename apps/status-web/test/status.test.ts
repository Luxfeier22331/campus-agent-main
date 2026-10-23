import { describe, expect, it } from "vitest";

import {
	aggregateServiceStatus,
	buildAvailabilitySnapshot,
	markExpiredSnapshot,
} from "../src/status/aggregate";
import {
	CAMPUS_QA_DEFINITION,
	CAMPUS_SERVICES_DEFINITION,
	missingStatusRuntimeConfig,
	resolveStatusEnvironment,
	resolveStatusOrigin,
	resolveStatusRuntimeConfig,
	STATUS_SERVICE_DEFINITIONS,
	serviceProbes,
} from "../src/status/config";
import { type CampusHtmlStructure, runProbe } from "../src/status/probes";
import type { ProbeObservation } from "../src/status/types";

const HTML_STRUCTURE: CampusHtmlStructure = {
	moduleScriptSources: ["/src/main.tsx"],
	rootMountCount: 1,
	title: "MUC Campus",
};

function response(body: string, headers: Record<string, string>, status = 200, url = ""): Response {
	const result = new Response(body, { headers, status });
	if (url) {
		Object.defineProperty(result, "url", { value: url });
	}
	return result;
}

function observation(
	probeId: string,
	serviceId: string,
	status: ProbeObservation["status"] = "passed",
): ProbeObservation {
	return {
		checkedAt: "2026-08-07T00:05:00.000Z",
		errorKind: status === "passed" || status === "unknown" ? null : "content",
		httpStatus: status === "passed" || status === "unknown" ? 200 : 503,
		latencyMs: 1,
		probeId,
		serviceId,
		status,
	};
}

function allObservations(statusById: Record<string, ProbeObservation["status"]> = {}) {
	return STATUS_SERVICE_DEFINITIONS.flatMap((definition) =>
		serviceProbes(definition).map((probe) =>
			observation(probe.id, probe.serviceId, statusById[probe.id] ?? "passed"),
		),
	);
}

describe("status configuration", () => {
	it("contains only the QA and non-QA site probes", () => {
		expect(STATUS_SERVICE_DEFINITIONS.map(({ id }) => id)).toEqual([
			"campus.qa",
			"campus.services",
		]);
		expect(serviceProbes(CAMPUS_QA_DEFINITION).map(({ path }) => path)).toEqual([
			"/api/chat/availability",
		]);
		expect(serviceProbes(CAMPUS_SERVICES_DEFINITION).map(({ path }) => path)).toEqual(["/"]);
		expect(serviceProbes(CAMPUS_QA_DEFINITION)).toHaveLength(1);
		expect(serviceProbes(CAMPUS_SERVICES_DEFINITION)).toHaveLength(1);
	});

	it("requires credential-free origins and HTTPS outside development", () => {
		expect(resolveStatusOrigin("http://127.0.0.1:27014", "development")).toBe(
			"http://127.0.0.1:27014/",
		);
		expect(resolveStatusOrigin("https://campus.example.test", "development")).toBe(
			"https://campus.example.test/",
		);
		expect(resolveStatusOrigin("http://campus.example.test", "staging")).toBeNull();
		expect(resolveStatusOrigin("http://campus.example.test", "production")).toBeNull();
		expect(resolveStatusOrigin("https://user:pass@campus.example.test", "production")).toBeNull();
		for (const value of [
			"https://campus.example.test/docs",
			"https://campus.example.test/?x=1",
			"https://campus.example.test/#fragment",
		]) {
			expect(resolveStatusOrigin(value, "production")).toBeNull();
		}
	});

	it("reports all readiness errors in one response field", () => {
		expect(missingStatusRuntimeConfig({ DEPLOYMENT_ENVIRONMENT: "production-like" })).toEqual([
			"DEPLOYMENT_ENVIRONMENT",
			"ASSETS binding",
			"STATUS_CAMPUS_ORIGIN",
			"STATUS_QA_ORIGIN",
			"CAMPUS_WEB_PUBLIC_ORIGIN",
		]);
		expect(() => resolveStatusEnvironment("production-like")).toThrow();
	});

	it("accepts a complete development configuration without KV", () => {
		expect(
			missingStatusRuntimeConfig({
				ASSETS: {},
				CAMPUS_WEB_PUBLIC_ORIGIN: "http://127.0.0.1:27014",
				DEPLOYMENT_ENVIRONMENT: "development",
				STATUS_CAMPUS_ORIGIN: "http://127.0.0.1:27014",
				STATUS_QA_ORIGIN: "http://127.0.0.1:27031",
			}),
		).toEqual([]);
	});
});

describe("status probes", () => {
	it.each(["", "校园问答"])("accepts the Campus shell with title %j", async (title) => {
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("shell", { "content-type": "text/html" }),
				htmlParser: async () => ({ ...HTML_STRUCTURE, title }),
			}),
		).resolves.toMatchObject({ status: "passed", httpStatus: 200 });
	});

	it("reports a parser failure as unknown rather than a product outage", async () => {
		const result = await runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
			fetchFn: async () => response("shell", { "content-type": "text/html" }),
			htmlParser: async () => {
				throw new Error("HTML parser unavailable");
			},
		});
		expect(result).toMatchObject({ status: "unknown", httpStatus: 200 });
		expect(aggregateServiceStatus(CAMPUS_SERVICES_DEFINITION, [result])).toBe("unknown");
	});

	it("validates the shared Campus shell structure", async () => {
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("<html>shell</html>", { "content-type": "text/html" }),
				htmlParser: async () => HTML_STRUCTURE,
			}),
		).resolves.toMatchObject({ status: "passed", httpStatus: 200 });
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("<html>login</html>", { "content-type": "text/html" }),
				htmlParser: async () => ({ ...HTML_STRUCTURE, title: "登录" }),
			}),
		).resolves.toMatchObject({ status: "invalid", errorKind: "content" });
	});

	it("maps the QA availability response into probe results", async () => {
		const definition = CAMPUS_QA_DEFINITION.shell;
		await expect(
			runProbe(definition, "https://campus.example.test", {
				fetchFn: async () =>
					response('{"status":"operational"}', { "content-type": "application/json" }),
			}),
		).resolves.toMatchObject({ status: "passed", httpStatus: 200 });
		await expect(
			runProbe(definition, "https://campus.example.test", {
				fetchFn: async () =>
					response('{"status":"outage"}', { "content-type": "application/json" }),
			}),
		).resolves.toMatchObject({ status: "failed", errorKind: null, httpStatus: 200 });
		await expect(
			runProbe(definition, "https://campus.example.test", {
				fetchFn: async () =>
					response('{"status":"unknown"}', { "content-type": "application/json" }),
			}),
		).resolves.toMatchObject({ status: "unknown", errorKind: null, httpStatus: 200 });
		for (const body of ['{"status":"not_ready"}', "{}", '{"error":"not ready"}']) {
			await expect(
				runProbe(definition, "https://campus.example.test", {
					fetchFn: async () => response(body, { "content-type": "application/json" }),
				}),
			).resolves.toMatchObject({ status: "invalid", errorKind: "content" });
		}
	});

	it("rejects wrong content types and accepts JSON media types", async () => {
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("<html></html>", { "content-type": "text/html-error" }),
				htmlParser: async () => HTML_STRUCTURE,
			}),
		).resolves.toMatchObject({ status: "invalid", errorKind: "content" });
		await expect(
			runProbe(CAMPUS_QA_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () =>
					response('{"status":"operational"}', {
						"content-type": "application/vnd.campus+json; charset=utf-8",
					}),
			}),
		).resolves.toMatchObject({ status: "passed" });
	});

	it("treats an HTTP 403 as a failed probe", async () => {
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("forbidden", { "content-type": "text/plain" }, 403),
			}),
		).resolves.toMatchObject({ status: "failed", errorKind: "http", httpStatus: 403 });
	});

	it("allows valid cross-origin redirects and rejects error redirects", async () => {
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () =>
					response(
						"shell",
						{ "content-type": "text/html" },
						200,
						"https://campus.example.test/docs/",
					),
				htmlParser: async () => HTML_STRUCTURE,
			}),
		).resolves.toMatchObject({ status: "passed" });
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () =>
					response("shell", { "content-type": "text/html" }, 200, "https://other.example.test/"),
				htmlParser: async () => HTML_STRUCTURE,
			}),
		).resolves.toMatchObject({ status: "passed" });
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () =>
					response(
						"error",
						{ "content-type": "text/html" },
						200,
						"https://other.example.test/error",
					),
				htmlParser: async () => HTML_STRUCTURE,
			}),
		).resolves.toMatchObject({ status: "invalid", errorKind: "content" });
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("shell", { "content-type": "text/html" }, 200, "/docs/"),
				htmlParser: async () => HTML_STRUCTURE,
			}),
		).resolves.toMatchObject({ status: "passed" });
	});

	it("classifies network failures and timeouts", async () => {
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				timeoutMs: 1,
				fetchFn: (_input, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
					}),
			}),
		).resolves.toMatchObject({ status: "timed_out", errorKind: "timeout" });
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => {
					throw new Error("network unavailable");
				},
			}),
		).resolves.toMatchObject({ status: "failed", errorKind: "network" });
	});

	it("enforces the deadline while reading and parsing response bodies", async () => {
		const slowBody = response("shell", { "content-type": "text/html" });
		Object.defineProperty(slowBody, "text", {
			value: () => new Promise<string>(() => undefined),
		});
		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => slowBody,
				htmlParser: async () => HTML_STRUCTURE,
				timeoutMs: 1,
			}),
		).resolves.toMatchObject({ status: "timed_out", errorKind: "timeout" });

		await expect(
			runProbe(CAMPUS_SERVICES_DEFINITION.shell, "https://campus.example.test", {
				fetchFn: async () => response("shell", { "content-type": "text/html" }),
				htmlParser: () => new Promise<CampusHtmlStructure>(() => undefined),
				timeoutMs: 1,
			}),
		).resolves.toMatchObject({ status: "timed_out", errorKind: "timeout" });
	});
});

describe("status aggregation", () => {
	const config = resolveStatusRuntimeConfig({
		DEPLOYMENT_ENVIRONMENT: "staging",
		STATUS_CAMPUS_ORIGIN: "https://campus.example.test",
		STATUS_QA_ORIGIN: "https://api.example.test",
	});
	const now = new Date("2026-08-07T00:05:00.000Z");

	function snapshot(statusById: Record<string, ProbeObservation["status"]> = {}) {
		return buildAvailabilitySnapshot({
			config,
			definitions: STATUS_SERVICE_DEFINITIONS,
			observations: allObservations(statusById),
			now,
			previous: null,
		});
	}

	it("keeps QA and non-QA site statuses independent", () => {
		expect(snapshot().services.map((service) => service.status)).toEqual([
			"operational",
			"operational",
		]);
		expect(
			snapshot({ "campus-qa-availability": "failed" }).services.map((service) => service.status),
		).toEqual(["outage", "operational"]);
		expect(
			snapshot({ "campus-web-shell": "failed" }).services.map((service) => service.status),
		).toEqual(["operational", "outage"]);
		expect(
			snapshot({ "campus-qa-availability": "unknown" }).services.map((service) => service.status),
		).toEqual(["unknown", "operational"]);
	});

	it("returns unknown when an expected observation is missing", () => {
		const observations = allObservations().filter(
			(item) => item.probeId !== "campus-qa-availability",
		);
		const result = buildAvailabilitySnapshot({
			config,
			definitions: STATUS_SERVICE_DEFINITIONS,
			observations,
			now,
			previous: null,
		});
		expect(result.services.map((service) => service.status)).toEqual(["unknown", "operational"]);
	});

	it("returns unknown for duplicate observations", () => {
		const result = buildAvailabilitySnapshot({
			config,
			definitions: STATUS_SERVICE_DEFINITIONS,
			observations: [...allObservations(), observation("campus-qa-availability", "campus.qa")],
			now,
			previous: null,
		});
		expect(result.services[0]?.status).toBe("unknown");
	});

	it("assigns timeline days to the Beijing calendar", () => {
		const result = buildAvailabilitySnapshot({
			config,
			definitions: STATUS_SERVICE_DEFINITIONS,
			observations: allObservations(),
			now: new Date("2026-08-06T16:00:00.000Z"),
			previous: null,
		});
		expect(result.services.every((service) => service.timeline[0]?.day === "2026-08-07")).toBe(
			true,
		);
	});

	it("expires current statuses while preserving history", () => {
		const result = snapshot();
		const expired = markExpiredSnapshot(result, new Date("2026-08-07T00:20:00.000Z"));
		expect(expired.services.map((service) => service.status)).toEqual(["unknown", "unknown"]);
		expect(expired.services.map((service) => service.timeline)).toEqual(
			result.services.map((service) => service.timeline),
		);
	});
});
