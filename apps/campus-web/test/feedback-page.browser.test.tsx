import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import { TestSessionProvider } from "./helpers/test-session";

const feedbackApiMock = vi.hoisted(() => ({ submitFeedback: vi.fn() }));

vi.mock("../src/features/feedback/api", () => feedbackApiMock);

describe("Feedback page in a real browser", () => {
	beforeEach(async () => {
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: {
				category: "map_issue",
				feedbackId: "feedback_browser",
				receivedAt: "2026-10-19T08:00:00.000Z",
				routeContext: "/feedback?source=map",
				status: "received",
			},
		});
		await page.viewport(1280, 800);
	});

	it("keeps the source context captured on first entry even if the URL changes", async () => {
		window.history.replaceState({}, "", "/feedback?source=map");
		const user = userEvent.setup();
		render(
			<TestSessionProvider session={{ data: null, status: "anonymous" }}>
				<FeedbackPage />
			</TestSessionProvider>,
		);

		expect(screen.getByLabelText("反馈来源")).toHaveValue("校园地图");

		window.history.replaceState({}, "", "/feedback");
		expect(screen.getByLabelText("反馈来源")).toHaveValue("校园地图");

		await user.type(screen.getByLabelText("问题描述"), "地图地点名称需要更新。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈已提交。")).toBeVisible();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith({
			body: "地图地点名称需要更新。",
			category: "content_issue",
			contact: null,
			routeContext: "/feedback?source=map",
		});
	});

	it("trims the optional contact on mobile widths", async () => {
		await page.viewport(390, 812);
		window.history.replaceState({}, "", "/feedback?source=mobile");
		const user = userEvent.setup();
		render(
			<TestSessionProvider session={{ data: null, status: "anonymous" }}>
				<FeedbackPage />
			</TestSessionProvider>,
		);

		expect(screen.getByLabelText("反馈来源")).toHaveValue("/feedback?source=mobile");
		await user.type(screen.getByLabelText("问题描述"), "移动端反馈表单需要保持可用。");
		await user.type(screen.getByLabelText(/联系方式/u), "  mobile@example.edu  ");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈已提交。")).toBeVisible();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith(
			expect.objectContaining({
				body: "移动端反馈表单需要保持可用。",
				contact: "mobile@example.edu",
				routeContext: "/feedback?source=mobile",
			}),
		);
	});

	it("surfaces a submit failure", async () => {
		feedbackApiMock.submitFeedback.mockRejectedValue(new Error("offline"));
		window.history.replaceState({}, "", "/feedback");
		const user = userEvent.setup();
		render(
			<TestSessionProvider session={{ data: null, status: "anonymous" }}>
				<FeedbackPage />
			</TestSessionProvider>,
		);

		await user.type(screen.getByLabelText("问题描述"), "需要重试。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈暂时没有提交成功。")).toBeVisible();
	});
});
