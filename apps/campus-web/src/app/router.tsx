import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { DiningRoutePending } from "@/components/dining/dining-page-skeleton";
import { NotFoundPage, RootLayout, RoutePending } from "./root-layout";

const ConversationPage = lazy(() =>
	import("./routes/conversation-page").then((module) => ({ default: module.ConversationPage })),
);
const LazyDiningPage = lazy(() =>
	import("./routes/dining-page").then((module) => ({ default: module.DiningPage })),
);

function DiningPage() {
	return (
		<Suspense fallback={<DiningRoutePending />}>
			<LazyDiningPage />
		</Suspense>
	);
}
const FeedbackPage = lazy(() =>
	import("./routes/feedback-page").then((module) => ({ default: module.FeedbackPage })),
);
const HomePage = lazy(() =>
	import("./routes/home-page").then((module) => ({ default: module.HomePage })),
);
const MapPage = lazy(() =>
	import("./routes/map-page").then((module) => ({ default: module.MapPage })),
);
const ServicesPage = lazy(() =>
	import("./routes/services-page").then((module) => ({ default: module.ServicesPage })),
);
const AccountPage = lazy(() =>
	import("./routes/account-page").then((module) => ({ default: module.AccountPage })),
);
const AccountLoginPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountAuthPage view="signIn" />,
	})),
);
const AccountRegisterPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountAuthPage view="signUp" />,
	})),
);
const AccountForgotPasswordPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountAuthPage view="forgotPassword" />,
	})),
);
const AccountResetPasswordPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountAuthPage view="resetPassword" />,
	})),
);
const AccountSignOutPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountAuthPage view="signOut" />,
	})),
);
const AccountSettingsPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountSettingsPage view="account" />,
	})),
);
const AccountSecurityPage = lazy(() =>
	import("./routes/account-page").then((module) => ({
		default: () => <module.AccountSettingsPage view="security" />,
	})),
);
const FederationConsentPage = lazy(() =>
	import("./routes/federation-pages").then((module) => ({ default: module.FederationConsentPage })),
);
const FederationErrorPage = lazy(() =>
	import("./routes/federation-pages").then((module) => ({ default: module.FederationErrorPage })),
);
const LegalPageModule = () => import("./routes/legal-page");
const LegalTermsPage = lazy(() =>
	LegalPageModule().then((module) => ({ default: module.LegalTermsPage })),
);
const LegalPrivacyPage = lazy(() =>
	LegalPageModule().then((module) => ({ default: module.LegalPrivacyPage })),
);

const rootRoute = createRootRoute({
	component: RootLayout,
	notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
	component: HomePage,
	getParentRoute: () => rootRoute,
	path: "/",
});

const conversationRoute = createRoute({
	component: ConversationPage,
	getParentRoute: () => rootRoute,
	path: "/c/$conversationId",
});

const mapRoute = createRoute({
	component: MapPage,
	getParentRoute: () => rootRoute,
	path: "/map",
});

const diningRoute = createRoute({
	component: DiningPage,
	getParentRoute: () => rootRoute,
	loader: async () => {
		const { preloadDiningRoute } = await import("@/features/dining/preload");
		await preloadDiningRoute();
	},
	pendingComponent: DiningRoutePending,
	path: "/dining",
	validateSearch: (search: Record<string, unknown>) => ({
		floor: optionalDiningSearchParam(search.floor),
		hall: optionalDiningSearchParam(search.hall),
	}),
});

const servicesRoute = createRoute({
	component: ServicesPage,
	getParentRoute: () => rootRoute,
	path: "/services",
});

const feedbackRoute = createRoute({
	component: FeedbackPage,
	getParentRoute: () => rootRoute,
	path: "/feedback",
});

const accountRoute = createRoute({
	component: AccountPage,
	getParentRoute: () => rootRoute,
	path: "/account",
});

const accountLoginRoute = createRoute({
	component: AccountLoginPage,
	getParentRoute: () => rootRoute,
	path: "/account/login",
});

const accountRegisterRoute = createRoute({
	component: AccountRegisterPage,
	getParentRoute: () => rootRoute,
	path: "/account/register",
});

const accountForgotPasswordRoute = createRoute({
	component: AccountForgotPasswordPage,
	getParentRoute: () => rootRoute,
	path: "/account/forgot-password",
});

const accountResetPasswordRoute = createRoute({
	component: AccountResetPasswordPage,
	getParentRoute: () => rootRoute,
	path: "/account/reset-password",
});

const accountSignOutRoute = createRoute({
	component: AccountSignOutPage,
	getParentRoute: () => rootRoute,
	path: "/account/sign-out",
});

const accountSettingsRoute = createRoute({
	component: AccountSettingsPage,
	getParentRoute: () => rootRoute,
	path: "/account/settings/account",
});

const accountSecurityRoute = createRoute({
	component: AccountSecurityPage,
	getParentRoute: () => rootRoute,
	path: "/account/settings/security",
});

const accountFederationConsentRoute = createRoute({
	component: FederationConsentPage,
	getParentRoute: () => rootRoute,
	path: "/account/federation/consent",
});

const accountFederationErrorRoute = createRoute({
	component: FederationErrorPage,
	getParentRoute: () => rootRoute,
	path: "/account/federation/error",
});

const legalTermsRoute = createRoute({
	component: LegalTermsPage,
	getParentRoute: () => rootRoute,
	path: "/legal/terms",
});

const legalPrivacyRoute = createRoute({
	component: LegalPrivacyPage,
	getParentRoute: () => rootRoute,
	path: "/legal/privacy",
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	conversationRoute,
	mapRoute,
	diningRoute,
	servicesRoute,
	feedbackRoute,
	accountRoute,
	accountLoginRoute,
	accountRegisterRoute,
	accountForgotPasswordRoute,
	accountResetPasswordRoute,
	accountSignOutRoute,
	accountSettingsRoute,
	accountSecurityRoute,
	accountFederationConsentRoute,
	accountFederationErrorRoute,
	legalTermsRoute,
	legalPrivacyRoute,
]);

const router = createRouter({
	defaultPendingComponent: RoutePending,
	defaultPendingMinMs: 200,
	defaultPendingMs: 100,
	defaultPreload: "intent",
	routeTree,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

export function AppRouter() {
	return <RouterProvider router={router} />;
}

function optionalDiningSearchParam(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
