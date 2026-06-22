import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Auth } from "../src/components/auth/auth";
import { CampusAuthUIProvider } from "../src/components/auth/auth-ui-provider";

vi.mock("better-auth-ui", () => ({
	AuthView: ({ redirectTo, view }: { redirectTo?: string; view?: string }) => (
		<section aria-label="auth-view" data-redirect-to={redirectTo ?? ""} data-view={view} />
	),
}));

vi.mock("better-auth-ui/tanstack", () => ({
	AuthUIProviderTanstack: ({
		children,
		redirectTo,
	}: {
		children: React.ReactNode;
		redirectTo?: string;
	}) => (
		<section aria-label="auth-ui-provider" data-redirect-to={redirectTo ?? ""}>
			{children}
		</section>
	),
}));

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

describe("campus auth UI components", () => {
	beforeEach(() => {
		window.history.pushState({}, "", "/account/login");
	});

	it("does not hard-code AuthView redirect targets", () => {
		render(<Auth view="SIGN_IN" />);

		expect(screen.getByLabelText("auth-view")).toHaveAttribute("data-redirect-to", "");
	});

	it("uses the existing campus return-target whitelist for provider redirects", () => {
		window.history.pushState({}, "", "/account/login?redirectTo=/internal-only");

		render(
			<CampusAuthUIProvider>
				<div>child</div>
			</CampusAuthUIProvider>,
		);

		expect(screen.getByLabelText("auth-ui-provider")).toHaveAttribute(
			"data-redirect-to",
			"/account",
		);
	});
});
