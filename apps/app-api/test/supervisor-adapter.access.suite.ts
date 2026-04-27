import { expect, it, vi } from "vitest";

import type { SupervisorAdapterSuiteContext } from "./supervisor-adapter.test-support";

export function registerSupervisorAdapterAccessSuite(ctx: SupervisorAdapterSuiteContext): void {
	const { createActor, createContext, createSupervisorExecutionClient, probeSupervisorApiReady } =
		ctx;

	it("adds Cloudflare Access service-token headers when supervisor machine ingress is protected", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					answer_text: "图书馆开放到 22:00。",
					error: null,
					follow_up_question: "",
					result: null,
					selected_target: "rag-agent",
					status: "completed",
					trace_id: "trace_01HQ",
				}),
				{ status: 200 },
			),
		);
		const client = createSupervisorExecutionClient(
			{
				SUPERVISOR_API_ACCESS_CLIENT_ID: "access-client-id",
				SUPERVISOR_API_ACCESS_CLIENT_SECRET: "access-client-secret",
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
				SUPERVISOR_API_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		await client.execute({
			actor: createActor(),
			context: createContext(),
			conversationId: "conv_01HQ",
			requestId: "req_access_01HQ",
			traceId: "trace_access_01HQ",
			userGoal: "图书馆开放到几点？",
		});

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://supervisor.internal/api/v1/answer",
			expect.objectContaining({
				headers: expect.objectContaining({
					"CF-Access-Client-Id": "access-client-id",
					"CF-Access-Client-Secret": "access-client-secret",
					"x-worker-origin-auth": "shared-secret",
				}),
			}),
		);
	});
	it("adds Cloudflare Access service-token headers to supervisor readiness probes", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ status: "ready" }), {
				headers: { "content-type": "application/json" },
				status: 200,
			}),
		);

		await probeSupervisorApiReady(
			{
				SUPERVISOR_API_ACCESS_CLIENT_ID: "access-client-id",
				SUPERVISOR_API_ACCESS_CLIENT_SECRET: "access-client-secret",
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			},
			{ fetchImplementation },
		);

		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://supervisor.internal/readyz",
			expect.objectContaining({
				headers: {
					"CF-Access-Client-Id": "access-client-id",
					"CF-Access-Client-Secret": "access-client-secret",
				},
				method: "GET",
			}),
		);
	});

	it("reports campus services structured runtime blockers from supervisor readiness", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					status: "ready",
					capability_gates: {
						campus_services: {
							open: true,
							gate: "structured_runtime",
						},
					},
					structured_query_runtime: {
						configured: true,
						projection_source: "postgres",
						service_status_projection_ready: true,
						service_status_read_model_configured: true,
						service_status_read_model_healthy: true,
						transport_schedule_implemented: true,
						transport_schedule_read_model_configured: true,
						transport_schedule_read_model_healthy: true,
						service_guide_projection_ready: false,
						service_guide_read_model_configured: true,
						service_guide_read_model_healthy: true,
						contact_directory_projection_ready: false,
						contact_directory_read_model_configured: true,
						contact_directory_read_model_healthy: true,
					},
				}),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				},
			),
		);

		const result = await probeSupervisorApiReady(
			{
				SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
			},
			{ fetchImplementation },
		);

		expect(result.campusServicesProductPath).toEqual({
			status: "blocked",
			capabilityGate: "open",
			projectionSource: "postgres",
			checks: {
				contactDirectoryProjection: "not_ready",
				contactDirectoryReadModel: "ready",
				serviceGuideProjection: "not_ready",
				serviceGuideReadModel: "ready",
				serviceStatusProjection: "ready",
				serviceStatusReadModel: "ready",
				structuredQueryRuntime: "ready",
				transportSchedule: "ready",
				transportScheduleReadModel: "ready",
			},
			blockers: {
				contactDirectoryProjection: "contact_directory_projection_ready is false",
				serviceGuideProjection: "service_guide_projection_ready is false",
			},
		});
	});
}
