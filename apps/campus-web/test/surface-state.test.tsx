import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SurfaceState } from "../src/components/ui/surface-state";

describe("surface state", () => {
	it("marks loading states as busy status regions", () => {
		render(<SurfaceState description="正在读取班车数据" kind="loading" title="正在加载" />);

		const status = screen.getByRole("status", { name: "正在加载" });
		expect(status).toHaveAttribute("aria-busy", "true");
		expect(status).toHaveTextContent("正在读取班车数据");
	});

	it("uses the shared reduced-motion aware entrance treatment", () => {
		render(<SurfaceState description="没有匹配结果" kind="empty" title="暂无结果" />);

		expect(screen.getByRole("status", { name: "暂无结果" })).toHaveClass(
			"motion-safe:animate-in",
			"motion-safe:fade-in-0",
		);
	});

	it("renders recoverable error actions near the state", () => {
		render(
			<SurfaceState
				description="请稍后重试或提交反馈。"
				kind="error"
				primaryAction={<button type="button">重试</button>}
				secondaryAction={<a href="/feedback">反馈</a>}
				title="暂时无法打开"
			/>,
		);

		expect(screen.getByRole("alert")).toHaveTextContent("暂时无法打开");
		expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "反馈" })).toHaveAttribute("href", "/feedback");
	});
});
