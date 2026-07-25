import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IngestionPage } from "../src/app/ingestion-page";

const ingestionStatus = {
	auth_maintenance: {
		errorCode: null,
		lastAttemptAt: "2026-07-17T03:30:00.000Z",
		lastOutcome: "SUCCESS",
		lastSuccessAt: "2026-07-17T03:30:03.000Z",
		nextRunAt: "2026-07-17T04:00:00.000Z",
		noticeProbeSucceeded: true,
		portalSessionEstablished: true,
		scheduleState: "ACTIVE",
		serviceTicketIssued: true,
	},
	file_release: null,
	notice: {
		publication: {
			errorCode: null,
			lastAttemptAt: "2026-07-17T03:30:00.000Z",
			lastOutcome: "PUBLISHED",
			lastReleaseId: "release:run-001:v1",
			nextRunAt: "2026-07-17T04:00:00.000Z",
			scheduleState: "ACTIVE",
			workflowId: "ingestion/internal-portal-notice-publication",
			workflowRunId: "run-001",
		},
		release: {
			checkpoint: { notices: [{ last_released_notice_id: 110, notice_type: "5" }] },
			current_release_id: "release:run-001:v1",
			item_count: 12,
			last_added_count: 2,
			last_check_at: "2026-07-17T03:31:00.000Z",
			last_check_error_code: null,
			last_check_mode: "incremental",
			last_check_outcome: "published",
			last_committed_at: "2026-07-17T03:31:00.000Z",
			last_published_at: "2026-07-17T03:31:00.000Z",
			last_reconcile_at: "2026-07-14T03:00:00.000Z",
			last_updated_count: 1,
			last_withdrawn_count: 0,
			stream_id: "internal_portal:muc_internal_portal:notice",
			version: 1,
		},
	},
	schema_version: "internal_portal_ingestion_status.v1",
};

describe("Ingestion page", () => {
	it("reports a manual refresh until both status queries settle", async () => {
		const refresh = deferredResponse();
		let statusReads = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const path = requestPath(input);
				if (path === "/api/ops/ingestion/status") {
					statusReads += 1;
					return statusReads === 1 ? Response.json(ingestionStatus) : refresh.promise;
				}
				if (path === "/api/ops/ingestion/tasks?limit=50") {
					return Response.json({ page: { next_cursor: null }, tasks: [] });
				}
				return Response.json({});
			}),
		);
		renderIngestionPage();

		fireEvent.click(await screen.findByRole("button", { name: "刷新" }));
		const button = await screen.findByRole("button", { name: "刷新中" });
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute("aria-busy", "true");

		refresh.resolve(Response.json(ingestionStatus));
		await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
	});
});

function renderIngestionPage() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<IngestionPage />
		</QueryClientProvider>,
	);
}

function requestPath(input: RequestInfo | URL) {
	const value = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	const url = new URL(value, "https://ops.example.test");
	return `${url.pathname}${url.search}`;
}

function deferredResponse() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
