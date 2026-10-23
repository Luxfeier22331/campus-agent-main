import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DiningSubmissionSheet } from "../src/components/dining/dining-submission-sheet";

vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({ data: null, status: "anonymous" }),
}));
vi.mock("@/features/dining/submission-api", async (original) => ({
	...(await original<typeof import("../src/features/dining/submission-api")>()),
	getDiningSubmission: () =>
		new Promise(() => {
			/* Keep the detail loading to verify focus independently of data. */
		}),
}));

function Fixture({ direct = false }: { direct?: boolean }) {
	const [open, setOpen] = useState(direct);
	return (
		<>
			<button type="button" data-dining-home>
				食堂地图
			</button>
			{!direct && (
				<button type="button" data-submission-id="submission-1" onClick={() => setOpen(true)}>
					查看状态
				</button>
			)}
			{open && (
				<DiningSubmissionSheet
					submissionId="submission-1"
					own={false}
					onClose={() => setOpen(false)}
					windowName={() => "窗口"}
				/>
			)}
		</>
	);
}

describe.each([390, 1440])("submission focus at %ipx", (width) => {
	it.each(["click", "Enter"])(
		"moves focus from %s trigger into detail and restores it on Escape",
		async (method) => {
			Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
			const user = userEvent.setup();
			render(
				<QueryClientProvider client={new QueryClient()}>
					<Fixture />
				</QueryClientProvider>,
			);
			const trigger = screen.getByRole("button", { name: "查看状态" });
			if (method === "click") {
				await user.click(trigger);
			} else {
				trigger.focus();
				await user.keyboard("{Enter}");
			}
			await waitFor(() => expect(screen.getByRole("heading", { name: "用户投稿" })).toHaveFocus());
			expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
			await user.keyboard("{Escape}");
			await waitFor(() => expect(trigger).toHaveFocus());
		},
	);
	it("focuses direct-open detail while loading and returns to the dining entry", async () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
		render(
			<QueryClientProvider client={new QueryClient()}>
				<Fixture direct />
			</QueryClientProvider>,
		);
		await waitFor(() => expect(screen.getByRole("heading", { name: "用户投稿" })).toHaveFocus());
		fireEvent.click(screen.getByRole("button", { name: /关闭|Close/ }));
		await waitFor(() => expect(screen.getByRole("button", { name: "食堂地图" })).toHaveFocus());
	});
});
