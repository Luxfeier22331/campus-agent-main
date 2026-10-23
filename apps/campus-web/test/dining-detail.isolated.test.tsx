import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	getDiningWindowMenu: vi.fn(),
	getDiningReviews: vi.fn(),
	createDiningReview: vi.fn(),
}));
vi.mock("../src/features/dining/api", async (original) => ({
	...(await original<typeof import("../src/features/dining/api")>()),
	...api,
}));
vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => ({ status: "authenticated", data: { user: { id: "user-1" } } }),
}));

import { DiningReviewSheet } from "../src/components/dining/dining-review-sheet";
import { DiningWindowDetail } from "../src/components/dining/dining-window-detail";
import { diningQueryKeys } from "../src/features/dining/queries";
import { DINING_FIXTURE_MAP } from "./dining-fixture-test-utils";

const item = { menuItemId: "dmi_1", name: "牛肉面", priceText: "12 元", sortOrder: 0 };
let client: QueryClient;
function wrap(children: ReactNode) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	for (const mock of Object.values(api)) {
		mock.mockReset();
	}
	api.getDiningReviews.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => client.clear());

describe("Dining detail states", () => {
	it("shows menu loading, retries a failed request and distinguishes an empty menu", async () => {
		const window = DINING_FIXTURE_MAP.halls[0]?.floors[0]?.windows[0];
		if (!window) {
			throw new Error("Dining fixture needs a window");
		}
		let reject: (error: Error) => void = () => undefined;
		api.getDiningWindowMenu
			.mockImplementationOnce(
				() =>
					new Promise((_, rejectRequest) => {
						reject = rejectRequest;
					}),
			)
			.mockResolvedValueOnce({ windowId: window.windowId, items: [item] })
			.mockResolvedValueOnce({ windowId: window.windowId, items: [] });
		render(
			wrap(
				<DiningWindowDetail
					window={window}
					floorLabel="海淀一层"
					selectedMenuItemId={null}
					onSelectMenuItem={vi.fn()}
				/>,
			),
		);
		expect(screen.getByText("正在读取菜单")).toBeVisible();
		await act(async () => reject(new Error("unavailable")));
		expect(await screen.findByText("菜单暂时无法读取。")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		expect(await screen.findByRole("button", { name: /牛肉面/u })).toBeVisible();
		await act(async () => {
			await client.invalidateQueries({ queryKey: diningQueryKeys.menu(window.windowId) });
		});
		// An empty menu leaves its section to the submissions block, which owns the empty state.
		await waitFor(() => expect(screen.queryByRole("heading", { name: "菜单" })).toBeNull());
		expect(api.getDiningWindowMenu).toHaveBeenCalledTimes(3);
	});

	it("reuses the review key after failure and publishes the review after a successful retry", async () => {
		const review = {
			anonymous: true,
			authorName: null,
			body: "晚餐时段出餐很快。",
			canDelete: true,
			canReport: false,
			createdAt: "2026-09-17T00:00:00Z",
			edited: false,
			hasReported: false,
			menuItemId: item.menuItemId,
			reviewId: "review-1",
		};
		api.createDiningReview
			.mockRejectedValueOnce(new Error("暂时无法提交评价。"))
			.mockImplementationOnce(async () => {
				api.getDiningReviews.mockResolvedValue({ items: [review], nextCursor: null });
				return review;
			});
		render(wrap(<DiningReviewSheet item={item} open onOpenChange={vi.fn()} />));
		fireEvent.change(screen.getByLabelText("评价内容"), { target: { value: review.body } });
		expect(screen.getByRole("checkbox", { name: "匿名公开" })).toBeChecked();
		fireEvent.click(screen.getByRole("button", { name: "提交" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法提交评价。");
		const first = api.createDiningReview.mock.calls[0]?.[0];
		expect(first).toMatchObject({
			anonymous: true,
			body: review.body,
			menuItemId: item.menuItemId,
			idempotencyKey: expect.any(String),
		});
		expect(first.idempotencyKey).not.toBe("");
		fireEvent.click(screen.getByRole("button", { name: "提交" }));
		expect(await screen.findByText(review.body)).toBeVisible();
		expect(api.createDiningReview.mock.calls[1]?.[0]).toEqual(first);
		await waitFor(() => expect(screen.getByLabelText("评价内容")).toHaveValue(""));
	});
});
