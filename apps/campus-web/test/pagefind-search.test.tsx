import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PagefindSearch from "../src/components/docs/pagefind-search";

describe("PagefindSearch", () => {
	it("renders a Chinese public docs search entry and dialog", () => {
		render(<PagefindSearch />);

		fireEvent.click(screen.getByRole("button", { name: "搜索公开文档" }));

		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByRole("searchbox", { name: "搜索公开文档" })).toHaveAttribute(
			"placeholder",
			"搜索公开文档",
		);
		expect(screen.getByRole("status")).toHaveTextContent("输入关键词搜索公开文档");
	});

	it("opens search with slash outside text entry controls", () => {
		render(<PagefindSearch />);

		fireEvent.keyDown(document, { key: "/" });

		expect(screen.getByRole("dialog")).toBeInTheDocument();
	});
});
