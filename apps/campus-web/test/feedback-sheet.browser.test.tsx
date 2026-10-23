import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { FeedbackSheet } from "../src/components/feedback/feedback-sheet";
import { TestSessionProvider, type TestSessionState } from "./helpers/test-session";

const feedbackApiMock = vi.hoisted(() => ({ submitFeedback: vi.fn() }));

vi.mock("../src/features/feedback/api", () => feedbackApiMock);

const DINING_ROUTE = "/dining?hall=fengtai&floor=fengtai-2f&window=w01";
const DINING_SOURCE = "食堂地图 · 荟贤食堂 · 荟贤二层 · 桂林米粉";
const SIGNED_IN: TestSessionState = {
	data: { user: { email: "student@example.edu", id: "user_01", name: "测试用户" } },
	status: "authenticated",
};
const ANONYMOUS: TestSessionState = { data: null, status: "anonymous" };

function renderSheet(
	session: TestSessionState,
	overrides: Partial<Parameters<typeof FeedbackSheet>[0]> = {},
): ReturnType<typeof vi.fn> {
	const onOpenChange = vi.fn();
	render(
		<TestSessionProvider session={session}>
			<FeedbackSheet
				defaultCategory="dining_issue"
				onOpenChange={onOpenChange}
				open
				sourceLabel={DINING_SOURCE}
				{...overrides}
			/>
		</TestSessionProvider>,
	);
	return onOpenChange;
}

describe("FeedbackSheet in a real browser", () => {
	beforeEach(async () => {
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: {
				category: "dining_issue",
				feedbackId: "fb_browser",
				receivedAt: "2026-10-19T08:00:00.000Z",
				routeContext: "/dining",
				status: "received",
			},
		});
		window.history.replaceState({}, "", DINING_ROUTE);
		await page.viewport(1280, 800);
	});

	it("records the current route and default category on open", async () => {
		renderSheet(ANONYMOUS);

		await expect.element(page.getByRole("heading", { name: "反馈" })).toBeVisible();
		expect(screen.getByLabelText("反馈来源")).toHaveValue(DINING_SOURCE);
		// Base UI Select renders a button combobox, so the value is its visible text.
		expect(screen.getByRole("combobox", { name: "问题类型" })).toHaveTextContent("食堂问题");
		expect(document.querySelector<HTMLInputElement>('input[value="dining_issue"]')).not.toBeNull();
	});

	it("defaults signed-in users to anonymous submission", async () => {
		renderSheet(SIGNED_IN);
		const user = userEvent.setup();

		expect(screen.getByLabelText("匿名提交")).toBeChecked();
		expect(screen.queryByLabelText(/联系方式/)).toBeNull();

		await user.type(screen.getByLabelText("问题描述"), "窗口菜单过期了。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈已提交。")).toBeVisible();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith({
			body: "窗口菜单过期了。",
			category: "dining_issue",
			contact: null,
			routeContext: DINING_ROUTE,
		});
	});

	it("reveals a prefilled, editable contact field when anonymity is unchecked", async () => {
		renderSheet(SIGNED_IN);
		const user = userEvent.setup();

		await user.click(screen.getByLabelText("匿名提交"));
		const contactField = screen.getByLabelText(/联系方式/);
		expect(contactField).toHaveValue("student@example.edu");

		await user.clear(contactField);
		await user.type(contactField, "other@example.org");
		await user.type(screen.getByLabelText("问题描述"), "窗口菜单过期了。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈已提交。")).toBeVisible();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith({
			body: "窗口菜单过期了。",
			category: "dining_issue",
			contact: "other@example.org",
			routeContext: DINING_ROUTE,
		});
	});

	it("keeps the manual contact field for anonymous visitors", async () => {
		renderSheet(ANONYMOUS);
		const user = userEvent.setup();

		expect(screen.queryByLabelText("匿名提交")).toBeNull();
		await user.type(screen.getByLabelText("问题描述"), "需要更新。");
		await user.type(screen.getByLabelText(/联系方式/), "  someone@example.edu  ");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈已提交。")).toBeVisible();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith({
			body: "需要更新。",
			category: "dining_issue",
			contact: "someone@example.edu",
			routeContext: DINING_ROUTE,
		});
	});

	it("closes the panel from the success state", async () => {
		const onOpenChange = renderSheet(ANONYMOUS);
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("问题描述"), "需要更新。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await screen.findByText("反馈已提交。");
		const form = document.querySelector("form");
		const closeButton = within(form as HTMLElement).getByRole("button", { name: "关闭" });
		await user.click(closeButton);

		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("renders a centered dialog above the mobile breakpoint", async () => {
		await page.viewport(1280, 800);
		renderSheet(ANONYMOUS);

		await expect.element(page.getByRole("heading", { name: "反馈" })).toBeVisible();
		expect(document.querySelectorAll("[data-vaul-drawer]")).toHaveLength(0);
	});

	it("keeps the centered dialog at phone widths", async () => {
		await page.viewport(390, 812);
		renderSheet(ANONYMOUS);

		const dialog = page.getByRole("dialog");
		await expect.element(dialog).toBeVisible();
		// Centered modal: horizontally centered regardless of viewport width.
		const box = (await dialog.element().getBoundingClientRect()) as DOMRect;
		expect(Math.abs(box.left + box.width / 2 - window.innerWidth / 2)).toBeLessThanOrEqual(1);
		expect(document.querySelectorAll("[data-vaul-drawer]")).toHaveLength(0);
	});
});
