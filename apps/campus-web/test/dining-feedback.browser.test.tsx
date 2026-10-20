import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { DiningPageView } from "../src/components/dining/dining-page-view";
import { FeedbackSheet } from "../src/components/feedback/feedback-sheet";
import { createCampusQueryClient } from "../src/platform/query/client";
import { createBrowserDiningFixture } from "./helpers/browser-dining-fixture";
import { TestSessionProvider } from "./helpers/test-session";

const feedbackApiMock = vi.hoisted(() => ({ submitFeedback: vi.fn() }));

vi.mock("../src/features/feedback/api", () => feedbackApiMock);

const ROUTE = "/dining?hall=fengtai&floor=fengtai-2f&window=fengtai%3A2f%3Awindow-2";

/**
 * Minimal map + dialog pairing, only to lay the two layers out at once.
 * The production wiring (trigger → `onOpenFeedback` → source label) is covered
 * by `dining-navigation.isolated.test.tsx`, which renders the real route.
 */
function DiningFeedbackSurface() {
	const mapRef = useRef<HTMLElement>(null);
	const [open, setOpen] = useState(false);
	const [queryClient] = useState(() => createCampusQueryClient());
	const data = createBrowserDiningFixture();
	const hall = data.halls[0];
	const floor = hall?.floors[0];
	const diningWindow = floor?.windows[1];
	if (!(hall && floor && diningWindow)) {
		throw new Error("fixture incomplete");
	}
	return (
		<TestSessionProvider session={{ data: null, status: "anonymous" }}>
			<QueryClientProvider client={queryClient}>
				<DiningPageView
					activeFloor={{ floor: { ...floor, hallId: hall.hallId }, windows: floor.windows }}
					data={data}
					isError={false}
					isPending={false}
					mapRef={mapRef}
					matchedWindowIds={null}
					onClearWindow={() => undefined}
					onOpenFeedback={() => setOpen(true)}
					onQueryChange={() => undefined}
					onRetry={() => undefined}
					onSelectFloor={() => undefined}
					onSelectHall={() => undefined}
					onSelectMenuItem={() => undefined}
					onSelectResult={() => undefined}
					onSelectWindow={() => undefined}
					query=""
					searchResults={[]}
					selectedFloor={floor}
					selectedHall={hall}
					selectedMenuItemId={null}
					selectedWindow={diningWindow}
				/>
				{open ? (
					<FeedbackSheet
						defaultCategory="dining_issue"
						onOpenChange={setOpen}
						open={open}
						sourceLabel={`食堂地图 · ${hall.name} · ${floor.label} · ${diningWindow.name}`}
					/>
				) : null}
			</QueryClientProvider>
		</TestSessionProvider>
	);
}

describe("Dining feedback dialog layout", () => {
	beforeEach(async () => {
		await page.viewport(1280, 800);
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: { feedbackId: "fb_01", receivedAt: "2026-10-19T08:00:00.000Z", status: "received" },
		});
		window.history.replaceState({}, "", ROUTE);
	});

	it("opens a centered dialog over the mobile detail panel", async () => {
		await page.viewport(390, 812);
		const user = userEvent.setup();
		render(<DiningFeedbackSurface />);

		await user.click(await screen.findByRole("button", { name: "信息有误？反馈" }));

		await expect.element(page.getByRole("heading", { name: "反馈" })).toBeVisible();
		// A centered modal, not the dining bottom drawer.
		expect(document.querySelectorAll("[data-vaul-drawer]")).toHaveLength(0);
		expect(screen.getByTestId("dining-detail-panel")).toBeInTheDocument();
	});
});
