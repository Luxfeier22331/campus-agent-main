import { expect, it, vi } from "vitest";

import { protectedPanelDataProvider } from "../src/panel/data-provider";
import { createJsonResponse, mockJsonFetch } from "./data-provider.test-support";

export function registerDataProviderSafetyAuditSuite() {
	it("uses sequential cursor history for operator safety anomaly queues", async () => {
		const fetchSpy = mockJsonFetch(
			{
				anomalies: [
					{
						anomalyCode: "projection_missing",
						anomalyId: "aclanom_01HQ",
						detectedAt: "2026-03-28T08:00:10.000Z",
						links: {
							issueFingerprint: "projection-missing",
							issueLink: "https://sentry.example/issues/789",
							traceLink: "https://sentry.example/traces/trace_01HQ",
						},
						principalType: "campus_member",
						requestId: "req_01HQ",
						selectedTarget: "rag-agent",
						severity: "high",
						status: "open",
						summary:
							"knowledge request finalized without the required policy projection for rag-agent.",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
				page: {
					nextCursor: "cursor_acl_02",
				},
			},
			{
				anomalies: [
					{
						anomalyCode: "projection_missing",
						anomalyId: "aclanom_02HQ",
						detectedAt: "2026-03-28T09:00:10.000Z",
						links: {
							issueFingerprint: "projection-missing",
							issueLink: "https://sentry.example/issues/790",
							traceLink: "https://sentry.example/traces/trace_02HQ",
						},
						principalType: "campus_member",
						requestId: "req_02HQ",
						selectedTarget: "rag-agent",
						severity: "high",
						status: "open",
						summary:
							"knowledge request finalized without the required policy projection for rag-agent.",
						surface: "public_chat_web",
						traceId: "trace_02HQ",
					},
				],
				page: {
					nextCursor: null,
				},
			},
		);

		const firstPage = await protectedPanelDataProvider.listOperatorSafetyAnomalies({
			anomalyCode: "projection_missing",
			page: 1,
			perPage: 10,
			selectedTarget: "rag-agent",
			severity: "high",
			signal: undefined,
			surface: "public_chat_web",
			window: "24h",
		});
		const secondPage = await protectedPanelDataProvider.listOperatorSafetyAnomalies({
			anomalyCode: "projection_missing",
			page: 2,
			perPage: 10,
			selectedTarget: "rag-agent",
			severity: "high",
			signal: undefined,
			surface: "public_chat_web",
			window: "24h",
		});

		expect(firstPage.data[0]).toMatchObject({
			anomalyId: "aclanom_01HQ",
			id: "aclanom_01HQ",
		});
		expect(secondPage.data[0]).toMatchObject({
			anomalyId: "aclanom_02HQ",
			id: "aclanom_02HQ",
		});
		expect(secondPage.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/operator/safety/anomalies?limit=10&window=24h&surface=public_chat_web&selectedTarget=rag-agent&severity=high&anomalyCode=projection_missing&cursor=cursor_acl_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);

		await expect(
			protectedPanelDataProvider.listOperatorSafetyAnomalies({
				anomalyCode: "projection_missing",
				page: 3,
				perPage: 10,
				selectedTarget: "rag-agent",
				severity: "high",
				signal: undefined,
				surface: "public_chat_web",
				window: "24h",
			}),
		).rejects.toMatchObject({
			status: 400,
		});
	});

	it("loads operator audit detail from the protected same-site seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				event: {
					auditEventId: "aevt_01HQ",
					diagnostics: {
						aclAnomalyCode: null,
						failClosed: false,
						sourceDocIds: ["handbook:library-hours"],
					},
					entitlementSnapshotId: "entitlements-2026-03-29",
					eventType: "request.completed",
					occurredAt: "2026-03-28T08:00:01.000Z",
					policyProjectionVersion: "2026-03-29",
					principalType: "campus_member",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					selectedTarget: "rag-agent",
					status: "completed",
					summary: "Knowledge request completed via rag-agent.",
					surface: "public_chat_web",
					terminalCode: "completed",
					traceId: "trace_01HQ",
				},
				links: {
					issueFingerprint: "timeout:execution-control",
					issueLink: "https://sentry.example/issues/123",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
			}),
		);

		await expect(
			protectedPanelDataProvider.getOperatorAuditEvent({
				auditEventId: "aevt_01HQ",
				signal: undefined,
			}),
		).resolves.toMatchObject({
			data: {
				event: {
					auditEventId: "aevt_01HQ",
					id: "aevt_01HQ",
				},
				links: {
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/audit/aevt_01HQ",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("encodes operator audit path identifiers before calling protected seams", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
				event: {
					auditEventId: "audit/01?debug=true#frag",
					diagnostics: {
						aclAnomalyCode: null,
						failClosed: false,
						sourceDocIds: [],
					},
					entitlementSnapshotId: null,
					eventType: "request.completed",
					occurredAt: "2026-03-28T08:00:01.000Z",
					policyProjectionVersion: null,
					principalType: "campus_member",
					requestId: "req_01HQ",
					requestedCapability: "knowledge",
					selectedTarget: "rag-agent",
					status: "completed",
					summary: "Knowledge request completed via rag-agent.",
					surface: "public_chat_web",
					terminalCode: "completed",
					traceId: "trace_01HQ",
				},
				links: {
					issueFingerprint: null,
					issueLink: null,
					traceLink: null,
				},
			}),
		);

		await protectedPanelDataProvider.getOperatorAuditEvent({
			auditEventId: "audit/01?debug=true#frag",
			signal: undefined,
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/audit/audit%2F01%3Fdebug%3Dtrue%23frag",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});

	it("maps operator audit list filters onto the protected same-site seam with sequential pagination", async () => {
		const fetchSpy = mockJsonFetch(
			{
				events: [
					{
						auditEventId: "aevt_01HQ",
						eventType: "request.completed",
						occurredAt: "2026-03-28T08:00:01.000Z",
						principalType: "campus_member",
						requestId: "req_01HQ",
						selectedTarget: "rag-agent",
						status: "completed",
						summary: "Knowledge request completed via rag-agent.",
						surface: "public_chat_web",
						traceId: "trace_01HQ",
					},
				],
				page: {
					nextCursor: "cursor_audit_02",
				},
			},
			{
				events: [
					{
						auditEventId: "aevt_02HQ",
						eventType: "request.error",
						occurredAt: "2026-03-28T08:05:01.000Z",
						principalType: "campus_member",
						requestId: "req_02HQ",
						selectedTarget: "rag-agent",
						status: "error",
						summary: "Knowledge request failed in runtime.",
						surface: "public_chat_web",
						traceId: "trace_02HQ",
					},
				],
				page: {
					nextCursor: null,
				},
			},
		);

		const firstPage = await protectedPanelDataProvider.listOperatorAudit({
			eventType: "request.completed",
			page: 1,
			perPage: 10,
			principalType: "campus_member",
			requestId: "req_01HQ",
			selectedTarget: "rag-agent",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});
		const secondPage = await protectedPanelDataProvider.listOperatorAudit({
			eventType: "request.completed",
			page: 2,
			perPage: 10,
			principalType: "campus_member",
			requestId: "req_01HQ",
			selectedTarget: "rag-agent",
			status: "completed",
			surface: "public_chat_web",
			traceId: "trace_01HQ",
		});

		expect(firstPage.data[0]).toMatchObject({
			auditEventId: "aevt_01HQ",
			id: "aevt_01HQ",
		});
		expect(secondPage.data[0]).toMatchObject({
			auditEventId: "aevt_02HQ",
			id: "aevt_02HQ",
		});
		expect(secondPage.pageInfo).toEqual({
			hasNextPage: false,
			hasPreviousPage: true,
		});
		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"/api/operator/audit?limit=10&requestId=req_01HQ&traceId=trace_01HQ&principalType=campus_member&surface=public_chat_web&selectedTarget=rag-agent&eventType=request.completed&status=completed",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"/api/operator/audit?limit=10&requestId=req_01HQ&traceId=trace_01HQ&principalType=campus_member&surface=public_chat_web&selectedTarget=rag-agent&eventType=request.completed&status=completed&cursor=cursor_audit_02",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});
}
