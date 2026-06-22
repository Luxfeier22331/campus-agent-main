import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RootLayout } from "../src/app/root-layout";

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
		Outlet: () => <div>route outlet</div>,
		useLocation: () => ({
			hash: "",
			pathname: "/",
			search: {},
		}),
		useNavigate: () => vi.fn(),
	};
});

vi.mock("@/components/auth/user/user-button", () => ({
	UserButton: () => (
		<button aria-label="账号" type="button">
			账号
		</button>
	),
}));

describe("root layout auth provider integration", () => {
	it("provides TanStack Query context required by Better Auth UI", async () => {
		render(<RootLayout />);

		expect(await screen.findByText("route outlet")).toBeInTheDocument();
	});
});
