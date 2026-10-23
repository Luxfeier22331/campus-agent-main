import { SheetDescription, SheetTitle } from "@campus-agent/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AdaptiveSheetSurface } from "../src/components/dining/dining-overlay-surface";
import { DiningReviewSheet } from "../src/components/dining/dining-review-sheet";
import { DiningSubmissionExitProvider } from "../src/components/dining/dining-submission-exit";
import { DiningWindowSubmissions } from "../src/components/dining/dining-window-submissions";

vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({ status: "authenticated", data: { user: { id: "user-1" } } }),
}));
vi.mock("@/features/dining/api", async (original) => ({
	...(await original<typeof import("../src/features/dining/api")>()),
	getDiningReviews: async () => ({ items: [], nextCursor: null }),
}));
vi.mock("@/features/dining/submission-api", async (original) => ({
	...(await original<typeof import("../src/features/dining/submission-api")>()),
	getDiningSubmissions: async () => ({ items: [], nextCursor: null }),
}));

function ReviewFixture({ nested }: { nested: boolean }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const title = useRef<HTMLHeadingElement>(null);
	const content = (
		<>
			<button ref={trigger} type="button" onClick={() => setOpen(true)}>
				查看评价
			</button>
			{open && (
				<DiningReviewSheet
					open
					item={{ menuItemId: "menu-1", name: "牛肉面", priceText: "12 元", sortOrder: 0 }}
					onOpenChange={setOpen}
					returnFocusRef={trigger}
				/>
			)}
		</>
	);
	return nested ? (
		<AdaptiveSheetSurface
			open
			onOpenChange={() => undefined}
			onOpenAutoFocus={(e) => {
				e.preventDefault();
				title.current?.focus();
			}}
		>
			<SheetTitle ref={title} tabIndex={-1}>
				父层详情
			</SheetTitle>
			<SheetDescription>查看投稿</SheetDescription>
			{content}
		</AdaptiveSheetSurface>
	) : (
		content
	);
}
function wrap(content: React.ReactNode) {
	return (
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DiningSubmissionExitProvider>{content}</DiningSubmissionExitProvider>
		</QueryClientProvider>
	);
}
describe.each([390, 1440])("Dining overlays at %ipx", (width) => {
	it("focuses the create title and restores its trigger", async () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
		const user = userEvent.setup();
		render(
			wrap(
				<DiningWindowSubmissions
					windowId="window-1"
					windowName="兰州拉面"
					onOpen={vi.fn()}
					onSaved={vi.fn()}
				/>,
			),
		);
		const trigger = screen.getByRole("button", { name: "投稿" });
		await user.click(trigger);
		await waitFor(() =>
			expect(screen.getByRole("heading", { name: "发布用户投稿" })).toHaveFocus(),
		);
		expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "关闭" }));
		await waitFor(() => expect(trigger).toHaveFocus());
	});
	it.each([false, true])("focuses reviews and restores the entry (nested=%s)", async (nested) => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
		const user = userEvent.setup();
		render(wrap(<ReviewFixture nested={nested} />));
		const trigger = screen.getByRole("button", { name: "查看评价" });
		trigger.focus();
		await user.keyboard("{Enter}");
		await waitFor(() => expect(screen.getByRole("heading", { name: "牛肉面" })).toHaveFocus());
		expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(trigger).toHaveFocus());
		expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
	});
});
