import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeedbackForm } from "../src/components/feedback/feedback-form";

describe("FeedbackForm", () => {
	it("renders with default category and source label", () => {
		render(<FeedbackForm routeContext="/test" sourceLabel="测试来源" submit={vi.fn()} />);

		expect(screen.getByRole("combobox", { name: "问题类型" })).toHaveTextContent("内容问题");
		expect(screen.getByDisplayValue("测试来源")).toBeInTheDocument();
	});

	it("renders with preselected category", () => {
		render(
			<FeedbackForm
				defaultCategory="dining_issue"
				routeContext="/dining"
				sourceLabel="食堂地图"
				submit={vi.fn()}
			/>,
		);

		expect(screen.getByRole("combobox", { name: "问题类型" })).toHaveTextContent("食堂问题");
	});

	it("submits feedback and shows success state", async () => {
		const user = userEvent.setup();
		const mockSubmit = vi.fn().mockResolvedValue(undefined);
		const mockOnDone = vi.fn();

		render(
			<FeedbackForm
				onDone={mockOnDone}
				routeContext="/test"
				sourceLabel="测试来源"
				submit={mockSubmit}
			/>,
		);

		await user.type(screen.getByLabelText("问题描述"), "这是一个测试反馈。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await waitFor(() => {
			expect(mockSubmit).toHaveBeenCalledWith({
				body: "这是一个测试反馈。",
				category: "content_issue",
				contact: null,
				routeContext: "/test",
			});
		});

		expect(screen.getByText("反馈已提交。")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "关闭" }));
		expect(mockOnDone).toHaveBeenCalledOnce();
	});

	it("shows error state when submission fails", async () => {
		const user = userEvent.setup();
		const mockSubmit = vi.fn().mockRejectedValue(new Error("Network error"));

		render(<FeedbackForm routeContext="/test" sourceLabel="测试来源" submit={mockSubmit} />);

		await user.type(screen.getByLabelText("问题描述"), "这是一个测试反馈。");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await waitFor(() => {
			expect(screen.getByText("反馈暂时没有提交成功。")).toBeInTheDocument();
		});

		expect(screen.getByRole("button", { name: "提交反馈" })).toBeInTheDocument();
	});

	it("trims contact field and sends null when empty", async () => {
		const user = userEvent.setup();
		const mockSubmit = vi.fn().mockResolvedValue(undefined);

		render(<FeedbackForm routeContext="/test" sourceLabel="测试来源" submit={mockSubmit} />);

		await user.type(screen.getByLabelText("问题描述"), "反馈内容");
		await user.type(screen.getByLabelText(/联系方式/), "   ");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await waitFor(() => {
			expect(mockSubmit).toHaveBeenCalledWith(
				expect.objectContaining({
					contact: null,
				}),
			);
		});
	});

	it("defaults signed-in users to anonymous submission", async () => {
		const user = userEvent.setup();
		const mockSubmit = vi.fn().mockResolvedValue(undefined);

		render(
			<FeedbackForm
				routeContext="/test"
				sessionContact="student@example.edu"
				sourceLabel="测试来源"
				submit={mockSubmit}
			/>,
		);

		expect(screen.getByLabelText("匿名提交")).toBeChecked();
		// Anonymous by default: no contact input is shown.
		expect(screen.queryByLabelText(/联系方式/)).toBeNull();

		await user.type(screen.getByLabelText("问题描述"), "反馈内容");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await waitFor(() => {
			expect(mockSubmit).toHaveBeenCalledWith(
				expect.objectContaining({
					contact: null,
				}),
			);
		});
	});

	it("reveals a prefilled, editable contact field when anonymity is unchecked", async () => {
		const user = userEvent.setup();
		const mockSubmit = vi.fn().mockResolvedValue(undefined);

		render(
			<FeedbackForm
				routeContext="/test"
				sessionContact="student@example.edu"
				sourceLabel="测试来源"
				submit={mockSubmit}
			/>,
		);

		await user.click(screen.getByLabelText("匿名提交"));
		const contactField = screen.getByLabelText(/联系方式/);
		expect(contactField).toHaveValue("student@example.edu");

		// The prefilled campus email is only a convenience default; replace it.
		await user.clear(contactField);
		await user.type(contactField, "other@example.org");

		await user.type(screen.getByLabelText("问题描述"), "反馈内容");
		await user.click(screen.getByRole("button", { name: "提交反馈" }));

		await waitFor(() => {
			expect(mockSubmit).toHaveBeenCalledWith(
				expect.objectContaining({
					contact: "other@example.org",
				}),
			);
		});
	});
});
