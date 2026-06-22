import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Auth } from "../src/components/auth/auth";
import { CampusAuthUIProvider } from "../src/components/auth/auth-ui-provider";

vi.mock("better-auth-ui", () => ({
	AuthUIProvider: ({
		additionalFields,
		children,
		redirectTo,
		signUp,
	}: {
		additionalFields?: Record<
			string,
			{ label?: React.ReactNode; required?: boolean; type?: string }
		>;
		children: React.ReactNode;
		redirectTo?: string;
		signUp?: { fields?: string[] };
	}) => (
		<section
			aria-label="auth-ui-provider"
			data-redirect-to={redirectTo ?? ""}
			data-sign-up-fields={signUp?.fields?.join(",") ?? ""}
			data-consent-required={String(additionalFields?.legalConsentAccepted?.required ?? false)}
			data-consent-type={additionalFields?.legalConsentAccepted?.type ?? ""}
		>
			<div data-testid="consent-label">{additionalFields?.legalConsentAccepted?.label}</div>
			{children}
		</section>
	),
	AuthView: ({ redirectTo, view }: { redirectTo?: string; view?: string }) => (
		<section aria-label="auth-view" data-redirect-to={redirectTo ?? ""} data-view={view} />
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

	it("renders the Better Auth sign-up view without a local consent gate", () => {
		render(<Auth view="SIGN_UP" />);

		expect(screen.getByLabelText("auth-view")).toHaveAttribute("data-view", "SIGN_UP");
		expect(screen.queryByText("请先阅读并同意用户服务协议和隐私政策。")).not.toBeInTheDocument();
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

	it("configures Better Auth UI to render a required non-persistent consent field", () => {
		render(
			<CampusAuthUIProvider>
				<div>child</div>
			</CampusAuthUIProvider>,
		);

		const provider = screen.getByLabelText("auth-ui-provider");
		expect(provider).toHaveAttribute("data-sign-up-fields", "name,legalConsentAccepted");
		expect(provider).toHaveAttribute("data-consent-required", "true");
		expect(provider).toHaveAttribute("data-consent-type", "boolean");
		expect(screen.getByTestId("consent-label")).toHaveTextContent("用户服务协议");
		expect(screen.getByTestId("consent-label")).toHaveTextContent("隐私政策");
	});
});
