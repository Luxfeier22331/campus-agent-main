import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "../src/app/root-layout";
import { FeedbackPage } from "../src/app/routes/feedback-page";
import { HomePage } from "../src/app/routes/home-page";

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({
			children,
			href,
			to,
			...props
		}: {
			children: React.ReactNode;
			href?: string;
			to?: string;
		}) => (
			<a href={href ?? to ?? "/"} {...props}>
				{children}
			</a>
		),
		useNavigate: () => vi.fn(),
	};
});

vi.mock("../src/features/conversation/api", () => ({
	listConversations: vi.fn().mockResolvedValue([]),
	submitChatRequest: vi.fn(),
}));

describe("campus routes", () => {
	it("renders the assistant-first home route", async () => {
		render(<HomePage />);

		expect(await screen.findByText("今天需要什么帮助")).toBeInTheDocument();
		expect(screen.getByText("校园地图")).toBeInTheDocument();
		expect(screen.getByText("饭堂分布图")).toBeInTheDocument();
	});

	it("renders global feedback form", () => {
		render(<FeedbackPage />);

		expect(screen.getByText("提交问题")).toBeInTheDocument();
		expect(screen.getByLabelText("问题描述")).toBeInTheDocument();
	});

	it("renders fail-closed not found page", () => {
		render(<NotFoundPage />);

		expect(screen.getByText("页面不存在")).toBeInTheDocument();
	});
});
