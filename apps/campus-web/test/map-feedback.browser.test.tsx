import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { FeedbackSheet } from "../src/components/feedback/feedback-sheet";
import { TestSessionProvider } from "./helpers/test-session";

const feedbackApiMock = vi.hoisted(() => ({ submitFeedback: vi.fn() }));

vi.mock("../src/features/feedback/api", () => feedbackApiMock);

describe("Map feedback panel in a real browser", () => {
	beforeEach(async () => {
		feedbackApiMock.submitFeedback.mockReset();
		feedbackApiMock.submitFeedback.mockResolvedValue({
			feedback: {
				category: "map_issue",
				feedbackId: "fb_map",
				receivedAt: "2026-10-19T08:00:00.000Z",
				routeContext: "/map",
				status: "received",
			},
		});
		window.history.replaceState({}, "", "/map");
		await page.viewport(1280, 800);
	});

	it("preselects the map category and submits the map route", async () => {
		render(
			<TestSessionProvider session={{ data: null, status: "anonymous" }}>
				<FeedbackSheet
					defaultCategory="map_issue"
					onOpenChange={() => undefined}
					open
					sourceLabel="校园地图"
				/>
			</TestSessionProvider>,
		);
		const user = userEvent.setup();

		await expect.element(page.getByRole("heading", { name: "反馈" })).toBeVisible();
		expect(screen.getByLabelText("反馈来源")).toHaveValue("校园地图");
		expect(screen.getByRole("combobox", { name: "问题类型" })).toHaveTextContent("地图问题");

		await user.type(screen.getByLabelText("问题描述"), "地图无法加载。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈已提交。")).toBeVisible();
		expect(feedbackApiMock.submitFeedback).toHaveBeenCalledWith({
			body: "地图无法加载。",
			category: "map_issue",
			contact: null,
			routeContext: "/map",
		});
	});

	it("surfaces a submit failure without losing the draft", async () => {
		feedbackApiMock.submitFeedback.mockRejectedValue(new Error("network down"));
		render(
			<TestSessionProvider session={{ data: null, status: "anonymous" }}>
				<FeedbackSheet
					defaultCategory="map_issue"
					onOpenChange={() => undefined}
					open
					sourceLabel="校园地图"
				/>
			</TestSessionProvider>,
		);
		const user = userEvent.setup();

		await user.type(screen.getByLabelText("问题描述"), "地图地点名称需要更新。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await expect.element(page.getByText("反馈暂时没有提交成功。")).toBeVisible();
		expect(screen.getByLabelText("问题描述")).toHaveValue("地图地点名称需要更新。");
		expect(screen.getByRole("button", { name: "提交反馈" })).toBeEnabled();
	});
});
