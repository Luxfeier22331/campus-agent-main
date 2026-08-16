import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceItemsList } from "../src/components/conversation/source-items";

describe("conversation source items", () => {
	it("renders Campus Docs sources as internal links", () => {
		render(
			<SourceItemsList
				sourceItems={[
					{
						collectionLabel: "学生手册",
						primaryAction: {
							disabledReason: null,
							external: false,
							href: "/docs/regulations/student_rules/network-guide/v/2026-current#account",
							label: "查看文档",
						},
						sectionTitle: "校园网账号",
						snippet: "校园网用户应按学校规定管理账号。",
						title: "上网指南",
						versionLabel: "2026 版",
					},
				]}
			/>,
		);

		expect(screen.getByText("上网指南")).toBeInTheDocument();
		expect(screen.getByText("学生手册 · 2026 版")).toBeInTheDocument();
		expect(screen.getByText("校园网用户应按学校规定管理账号。")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: "查看文档" });
		expect(link).toHaveAttribute(
			"href",
			"/docs/regulations/student_rules/network-guide/v/2026-current#account",
		);
		expect(link).not.toHaveAttribute("target");
	});
});
