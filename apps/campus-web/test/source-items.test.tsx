import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceItemsList } from "../src/components/conversation/source-items";

describe("conversation source items", () => {
	it("renders public web sources as external links", () => {
		render(
			<SourceItemsList
				sourceItems={[
					{
						collectionLabel: "公开网页",
						pageLabel: "",
						primaryAction: {
							disabledReason: null,
							external: true,
							href: "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
							label: "打开网页",
						},
						publisherLabel: "中央民族大学",
						sectionTitle: "",
						snippet: "校园网用户可通过数字校园相关页面查看上网指南。",
						title: "上网指南",
						trustLabel: "",
						versionLabel: "",
					},
				]}
			/>,
		);

		expect(screen.getByText("上网指南")).toBeInTheDocument();
		expect(screen.getByText("校园网用户可通过数字校园相关页面查看上网指南。")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: /打开网页/u });
		expect(link).toHaveAttribute("href", "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noreferrer noopener");
	});
});
