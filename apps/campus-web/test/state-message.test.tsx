import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StateMessage } from "../src/components/ui/state-message";

describe("state message", () => {
	it("renders a section state without adding a card container", () => {
		const { container } = render(
			<StateMessage description="没有匹配结果" role="status" title="暂无结果" />,
		);

		expect(screen.getByRole("status")).toHaveAttribute("data-state-message", "section");
		expect(screen.getByRole("heading", { name: "暂无结果" })).toBeInTheDocument();
		expect(container.querySelector('[data-slot="card"]')).toBeNull();
	});

	it("uses page layout only for page-level failures", () => {
		render(
			<StateMessage description="这个地址没有对应的页面。" layout="page" title="页面不存在" />,
		);

		expect(screen.getByText("这个地址没有对应的页面。").closest("div")).toHaveAttribute(
			"data-state-message",
			"page",
		);
	});

	it("keeps recoverable actions next to the affected state", () => {
		render(
			<StateMessage
				description="当前内容仍然保留。"
				primaryAction={<button type="button">重试</button>}
				role="alert"
				secondaryAction={<a href="/feedback">反馈</a>}
				title="暂时无法更新"
				tone="danger"
			/>,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("当前内容仍然保留。");
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toHaveAttribute("href", "/feedback");
	});
});
