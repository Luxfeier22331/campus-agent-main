import { render as renderReact, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { render as renderSearchResults } from "../src/docs/search/rspress-search-hooks";

describe("Rspress docs search result rendering", () => {
	it("renders protected search results as readable links", () => {
		renderReact(
			renderSearchResults([
				{
					documentTitle: "光电信息科学与工程培养方案",
					excerpt: "光电专业培养方案要求学生完成专业核心课程与实践环节。",
					kind: "result",
					sectionTitle: "培养目标",
					url: "/docs/curriculum/curriculum_plan/restricted-program?hl=root-1#program-root",
				},
			]),
		);

		const link = screen.getByRole("link", { name: /光电信息科学与工程培养方案/ });
		expect(link).toHaveAttribute(
			"href",
			"/docs/curriculum/curriculum_plan/restricted-program?hl=root-1#program-root",
		);
		expect(link).toHaveClass("docs-protected-search-result");
		expect(screen.getByText("培养目标")).toHaveClass("docs-protected-search-section");
		expect(screen.getByText(/专业核心课程/)).toHaveClass("docs-protected-search-excerpt");
	});

	it("renders protected search status as a non-link status row", () => {
		renderReact(
			renderSearchResults([
				{
					kind: "status",
					message: "账号可见文档搜索暂不可用",
				},
			]),
		);

		expect(screen.getByRole("status")).toHaveTextContent("账号可见文档搜索暂不可用");
		expect(screen.getByRole("status")).toHaveClass("docs-reader-status");
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});
});
