import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CampusSearchSection } from "../src/app/campus-search-diagnostics";
import { requestDetailPollInterval } from "../src/app/request-detail-page";
import { toCampusSearchDiagnostics } from "../src/server/ops-status/mapping/campus-search";
import type { OpsRequestDetailResponse } from "../src/shared/ops-contract";

describe("Campus Search Ops display", () => {
	it("shows absent diagnostics without implying retrieval failed", () => {
		render(<CampusSearchSection diagnostics={toCampusSearchDiagnostics([], true)} />);
		expect(screen.getByText(/NO_DATA/)).toBeInTheDocument();
		expect(screen.getByText(/旧请求不会回填/)).toBeInTheDocument();
	});
	it("polls only active requests", () => {
		expect(requestDetailPollInterval(undefined)).toBe(2000);
		expect(
			requestDetailPollInterval({
				request: { lifecyclePhase: "FINISHED" },
			} as OpsRequestDetailResponse),
		).toBe(false);
		expect(
			requestDetailPollInterval({
				request: { lifecyclePhase: "RUNNING" },
			} as OpsRequestDetailResponse),
		).toBe(2000);
	});
});
