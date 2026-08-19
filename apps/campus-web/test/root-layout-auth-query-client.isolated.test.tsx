import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const locationState = vi.hoisted(() => ({ pathname: "/" }));
const sessionState = vi.hoisted(() => ({
	data: null as null | { user: { passwordChangeRequired: boolean } },
	error: null as Error | null,
	isRefreshing: false,
	refresh: vi.fn().mockResolvedValue(undefined),
	status: "anonymous" as "anonymous" | "authenticated" | "loading" | "unavailable",
}));

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
			<a href={to ?? "/"} {...props}>
				{children}
			</a>
		),
		Outlet: () => <div>route outlet</div>,
		useLocation: () => ({ hash: "", pathname: locationState.pathname, search: {} }),
		useNavigate: () => navigate,
	};
});

vi.mock("@/platform/auth/session", () => ({
	useCampusSession: () => sessionState,
}));

import { RootLayout } from "../src/app/root-layout";

describe("root session journey guard", () => {
	beforeEach(() => {
		window.history.replaceState({}, "", "/");
		locationState.pathname = "/";
		sessionState.data = null;
		sessionState.error = null;
		sessionState.isRefreshing = false;
		sessionState.status = "anonymous";
		sessionState.refresh.mockClear();
		navigate.mockClear();
	});

	afterEach(cleanup);

	it("renders an ordinary public route for an anonymous session", () => {
		render(<RootLayout />);
		expect(screen.getByText("route outlet")).toBeInTheDocument();
	});

	it("does not block the login form while the initial session request is pending", () => {
		window.history.replaceState({}, "", "/account/login");
		locationState.pathname = "/account/login";
		sessionState.status = "loading";

		render(<RootLayout />);

		expect(screen.getByText("route outlet")).toBeInTheDocument();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("forces temporary-password users into the dedicated change page from every app route", async () => {
		window.history.replaceState({}, "", "/dining?hall=one#menu");
		locationState.pathname = "/dining";
		sessionState.status = "authenticated";
		sessionState.data = { user: { passwordChangeRequired: true } };

		render(<RootLayout />);

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				replace: true,
				search: { redirectTo: "/dining?hall=one#menu" },
				to: "/account/change-password",
			}),
		);
		expect(screen.queryByText("route outlet")).not.toBeInTheDocument();
	});

	it("redirects anonymous account settings to login with the original target", async () => {
		window.history.replaceState({}, "", "/account/settings/account");
		locationState.pathname = "/account/settings/account";

		render(<RootLayout />);

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				replace: true,
				search: { redirectTo: "/account/settings/account" },
				to: "/account/login",
			}),
		);
	});

	it("redirects anonymous notice readers to login with the full list target", async () => {
		window.history.replaceState({}, "", "/notices?category=student_affairs&page=2&stream=notices");
		locationState.pathname = "/notices";

		render(<RootLayout />);

		await waitFor(() =>
			expect(navigate).toHaveBeenCalledWith({
				replace: true,
				search: {
					redirectTo: "/notices?category=student_affairs&page=2&stream=notices",
				},
				to: "/account/login",
			}),
		);
	});

	it("does not misclassify a session service failure as signed out", () => {
		window.history.replaceState({}, "", "/account/settings/account");
		locationState.pathname = "/account/settings/account";
		sessionState.status = "unavailable";
		sessionState.error = new Error("503 dependency_not_ready");

		render(<RootLayout />);

		expect(screen.getByRole("heading", { name: "暂时无法确认登录状态" })).toBeVisible();
		expect(navigate).not.toHaveBeenCalled();
	});

	it("returns an authenticated user away from login to the safe target", async () => {
		window.history.replaceState({}, "", "/account/login?redirectTo=/map");
		locationState.pathname = "/account/login";
		sessionState.status = "authenticated";
		sessionState.data = { user: { passwordChangeRequired: false } };

		render(<RootLayout />);

		await waitFor(() => expect(navigate).toHaveBeenCalledWith({ replace: true, to: "/map" }));
	});
});
