import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Auth } from "../src/components/auth/auth";
import authSource from "../src/components/auth/auth.tsx?raw";
import { CampusAuthUIProvider } from "../src/components/auth/auth-ui-provider";
import authUIProviderSource from "../src/components/auth/auth-ui-provider.tsx?raw";
import { Settings } from "../src/components/auth/settings/settings";
import settingsSource from "../src/components/auth/settings/settings.tsx?raw";
import { UserButton } from "../src/components/auth/user/user-button";
import userButtonSource from "../src/components/auth/user/user-button.tsx?raw";
import mainSource from "../src/main.tsx?raw";

const stylesSource = readFileSync("src/styles.css", "utf8");

const capturedCaptchaPluginOptions = vi.hoisted(() => ({
	render: undefined as undefined | ((props: Record<string, unknown>) => React.ReactNode),
}));

vi.mock("@better-auth-ui/react/plugins", () => ({
	captchaPlugin: ({ render }: { render: (props: Record<string, unknown>) => React.ReactNode }) => {
		capturedCaptchaPluginOptions.render = render;
		return { id: "captcha", render };
	},
}));

vi.mock("@marsidev/react-turnstile", () => ({
	Turnstile: ({
		onError,
		onExpire,
		onSuccess,
		options,
		siteKey,
	}: {
		onError?: () => void;
		onExpire?: () => void;
		onSuccess?: (token: string) => void;
		options?: { appearance?: string; execution?: string };
		siteKey: string;
	}) => (
		<button
			aria-label="turnstile-captcha"
			data-appearance={options?.appearance ?? ""}
			data-execution={options?.execution ?? ""}
			data-site-key={siteKey}
			onClick={() => onSuccess?.("token")}
			onFocus={() => onExpire?.()}
			onMouseEnter={() => onError?.()}
			type="button"
		>
			Turnstile
		</button>
	),
}));

vi.mock("@better-auth-ui/heroui", () => ({
	Auth: ({ className, view }: { className?: string; view?: string }) => (
		<section aria-label="auth-view" data-class-name={className ?? ""} data-view={view} />
	),
	AuthProvider: ({
		additionalFields,
		basePaths,
		children,
		emailAndPassword,
		localization,
		plugins,
		redirectTo,
		viewPaths,
	}: {
		additionalFields?: {
			label?: React.ReactNode;
			name: string;
			profile?: boolean;
			required?: boolean;
			signUp?: boolean | string;
			type?: string;
		}[];
		basePaths?: { auth?: string; settings?: string };
		children: React.ReactNode;
		emailAndPassword?: {
			confirmPassword?: boolean;
			forgotPassword?: boolean;
			minPasswordLength?: number;
			rememberMe?: boolean;
		};
		localization?: {
			auth?: Record<string, string>;
			settings?: Record<string, string>;
		};
		plugins?: { id?: string }[];
		redirectTo?: string;
		viewPaths?: {
			auth?: Record<string, string>;
			settings?: Record<string, string>;
		};
	}) => {
		const consentField = additionalFields?.find((field) => field.name === "legalConsentAccepted");
		return (
			<section
				aria-label="auth-ui-provider"
				data-auth-base-path={basePaths?.auth ?? ""}
				data-auth-forgot-path={viewPaths?.auth?.forgotPassword ?? ""}
				data-auth-login-path={viewPaths?.auth?.signIn ?? ""}
				data-auth-register-path={viewPaths?.auth?.signUp ?? ""}
				data-confirm-password={String(emailAndPassword?.confirmPassword ?? false)}
				data-consent-profile={String(consentField?.profile ?? true)}
				data-consent-required={String(consentField?.required ?? false)}
				data-consent-sign-up={String(consentField?.signUp ?? false)}
				data-consent-type={consentField?.type ?? ""}
				data-has-captcha={String(plugins?.some((plugin) => plugin.id === "captcha") ?? false)}
				data-localization-current-session={localization?.settings?.currentSession ?? ""}
				data-localization-field-required={localization?.auth?.fieldRequired ?? ""}
				data-localization-forgot-password={localization?.auth?.forgotPassword ?? ""}
				data-localization-name={localization?.auth?.name ?? ""}
				data-localization-save={localization?.settings?.saveChanges ?? ""}
				data-localization-security={localization?.settings?.security ?? ""}
				data-localization-set-password={localization?.settings?.setPassword ?? ""}
				data-localization-sign-in={localization?.auth?.signIn ?? ""}
				data-localization-sign-up={localization?.auth?.signUp ?? ""}
				data-min-password-length={String(emailAndPassword?.minPasswordLength ?? "")}
				data-redirect-to={redirectTo ?? ""}
				data-remember-me={String(emailAndPassword?.rememberMe ?? false)}
				data-settings-base-path={basePaths?.settings ?? ""}
				data-settings-security-path={viewPaths?.settings?.security ?? ""}
			>
				<div data-testid="consent-label">{consentField?.label}</div>
				{children}
			</section>
		);
	},
	Settings: ({ className, view }: { className?: string; view?: string }) => (
		<section aria-label="account-view" data-class-name={className ?? ""} data-view={view} />
	),
	UserButton: ({
		placement,
		size,
		variant,
	}: {
		placement?: string;
		size?: string;
		variant?: string;
	}) => (
		<button
			aria-label="heroui-user-button"
			data-placement={placement ?? ""}
			data-size={size ?? ""}
			data-variant={variant ?? ""}
			type="button"
		>
			账号
		</button>
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
		capturedCaptchaPluginOptions.render = undefined;
	});

	it("passes the requested HeroUI auth view without local redirect overrides", () => {
		render(<Auth view="signIn" />);

		expect(screen.getByLabelText("auth-view")).toHaveAttribute("data-view", "signIn");
	});

	it("uses Better Auth UI HeroUI packages instead of the retired shadcn package", () => {
		expect(authUIProviderSource).toContain("@better-auth-ui/heroui");
		expect(authUIProviderSource).toContain("@better-auth-ui/react/plugins");
		expect(mainSource).toContain("@heroui/react");
		expect(authSource).toContain("@better-auth-ui/heroui");
		expect(settingsSource).toContain("@better-auth-ui/heroui");
		expect(userButtonSource).toContain("@better-auth-ui/heroui");
		expect(stylesSource).toContain('@import "@heroui/styles";');
		expect(stylesSource).toContain('@import "@better-auth-ui/heroui/styles";');
		expect(stylesSource.indexOf('@import "@heroui/styles";')).toBeLessThan(
			stylesSource.indexOf('@import "@better-auth-ui/heroui/styles";'),
		);
		for (const source of [authUIProviderSource, authSource, settingsSource, userButtonSource]) {
			expect(source).not.toMatch(/from\s+["']better-auth-ui["']/);
		}
	});

	it("mounts the HeroUI toast provider used by Better Auth UI error toasts", () => {
		expect(mainSource).toContain('<ToastProvider placement="top" />');
		expect(authUIProviderSource).not.toContain('from "sonner"');
		expect(authUIProviderSource).not.toContain("<ToastProvider");
	});

	it("does not add a duplicate local auth mutation toast bridge", () => {
		expect(authUIProviderSource).not.toContain("MutationCache");
		expect(authUIProviderSource).not.toContain("matchMutation");
		expect(authUIProviderSource).not.toContain("authMutationKeys");
		expect(authUIProviderSource).not.toContain("toast.danger");
	});

	it("uses only page-level layout for Better Auth UI auth views", () => {
		const { container } = render(<Auth view="signIn" />);

		expect(screen.getByLabelText("auth-view")).toHaveAttribute(
			"data-class-name",
			"mx-auto w-full max-w-sm",
		);
		expect(screen.getByLabelText("account-auth-layout")).toBeInTheDocument();
		expect(container.innerHTML).not.toContain("rounded-lg");
		expect(container.innerHTML).not.toContain("border-border");
		expect(container.innerHTML).not.toContain("bg-card");
		expect(container.innerHTML).not.toContain("shadow-");
	});

	it("marks auth and settings surfaces for scoped HeroUI theme overrides", () => {
		render(<Auth view="signIn" />);
		expect(screen.getByLabelText("account-auth-layout")).toHaveAttribute(
			"data-campus-account-surface",
			"auth",
		);

		render(<Settings view="account" />);
		expect(screen.getByLabelText("account-settings-layout")).toHaveAttribute(
			"data-campus-account-surface",
			"settings",
		);

		expect(stylesSource).toContain('[data-campus-account-surface="auth"]');
		expect(stylesSource).toContain('[data-slot="card"]');
		expect(stylesSource).toContain("--campus-auth-card-shadow: var(--shadow-auth-card)");
		expect(stylesSource).toContain("--campus-auth-link");
	});

	it("uses only page-level layout for Better Auth UI account settings", () => {
		const { container } = render(<Settings view="account" />);

		expect(screen.getByLabelText("account-view")).toHaveAttribute(
			"data-class-name",
			"mx-auto w-full max-w-4xl",
		);
		expect(screen.getByLabelText("account-settings-layout")).toBeInTheDocument();
		expect(container.innerHTML).not.toContain("rounded-lg");
		expect(container.innerHTML).not.toContain("border-border");
		expect(container.innerHTML).not.toContain("bg-card");
		expect(container.innerHTML).not.toContain("shadow-");
	});

	it("renders the Better Auth sign-up view without a local consent gate", () => {
		render(<Auth view="signUp" />);

		expect(screen.getByLabelText("auth-view")).toHaveAttribute("data-view", "signUp");
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
		expect(provider).toHaveAttribute("data-auth-base-path", "/account");
		expect(provider).toHaveAttribute("data-settings-base-path", "/account/settings");
		expect(provider).toHaveAttribute("data-auth-login-path", "login");
		expect(provider).toHaveAttribute("data-auth-register-path", "register");
		expect(provider).toHaveAttribute("data-auth-forgot-path", "forgot-password");
		expect(provider).toHaveAttribute("data-settings-security-path", "security");
		expect(provider).toHaveAttribute("data-confirm-password", "true");
		expect(provider).toHaveAttribute("data-consent-required", "true");
		expect(provider).toHaveAttribute("data-consent-sign-up", "true");
		expect(provider).toHaveAttribute("data-consent-profile", "false");
		expect(provider).toHaveAttribute("data-consent-type", "boolean");
		expect(provider).toHaveAttribute("data-min-password-length", "10");
		expect(provider).toHaveAttribute("data-remember-me", "true");
		expect(screen.getByTestId("consent-label")).toHaveTextContent("用户服务协议");
		expect(screen.getByTestId("consent-label")).toHaveTextContent("隐私政策");
	});

	it("localizes Better Auth UI account settings copy", () => {
		render(
			<CampusAuthUIProvider>
				<div>child</div>
			</CampusAuthUIProvider>,
		);

		const provider = screen.getByLabelText("auth-ui-provider");
		expect(provider).toHaveAttribute("data-localization-current-session", "当前设备");
		expect(provider).toHaveAttribute("data-localization-field-required", "此项必填");
		expect(provider).toHaveAttribute("data-localization-forgot-password", "找回密码");
		expect(provider).toHaveAttribute("data-localization-name", "姓名");
		expect(provider).toHaveAttribute("data-localization-save", "保存");
		expect(provider).toHaveAttribute("data-localization-security", "安全");
		expect(provider).toHaveAttribute("data-localization-set-password", "设置密码");
		expect(provider).toHaveAttribute("data-localization-sign-in", "登录校园问答");
		expect(provider).toHaveAttribute("data-localization-sign-up", "创建账号");
	});

	it("registers Turnstile through the Better Auth UI captcha plugin when configured", () => {
		document.body.innerHTML = `<script id="__CAMPUS_AUTH_CONFIG__" type="application/json">${JSON.stringify(
			{
				turnstileAppearance: "interaction-only",
				turnstileExecution: "render",
				turnstileSiteKey: "site-key-1",
			},
		)}</script>`;

		render(
			<CampusAuthUIProvider>
				<div>child</div>
			</CampusAuthUIProvider>,
		);

		expect(screen.getByLabelText("auth-ui-provider")).toHaveAttribute("data-has-captcha", "true");
		const setToken = vi.fn();
		const clearToken = vi.fn();
		const setReset = vi.fn();
		render(
			capturedCaptchaPluginOptions.render?.({
				clearToken,
				setReset,
				setToken,
			}),
		);

		const captcha = screen.getByLabelText("turnstile-captcha");
		expect(captcha).toHaveAttribute("data-site-key", "site-key-1");
		expect(captcha).toHaveAttribute("data-appearance", "interaction-only");
		expect(captcha).toHaveAttribute("data-execution", "render");
	});

	it("uses the HeroUI UserButton without a self-built trigger", () => {
		render(<UserButton />);

		const button = screen.getByLabelText("heroui-user-button");
		expect(button).toHaveAttribute("data-placement", "bottom end");
		expect(button).toHaveAttribute("data-size", "icon");
		expect(button).toHaveAttribute("data-variant", "ghost");
		expect(userButtonSource).not.toContain("trigger=");
		expect(userButtonSource).not.toContain("@/components/ui/button");
	});
});
