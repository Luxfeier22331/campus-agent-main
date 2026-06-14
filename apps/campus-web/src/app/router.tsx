import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { lazy } from "react";
import { NotFoundPage, RootLayout } from "./root-layout";

const ConversationPage = lazy(() =>
	import("./routes/conversation-page").then((module) => ({ default: module.ConversationPage })),
);
const DiningPage = lazy(() =>
	import("./routes/dining-page").then((module) => ({ default: module.DiningPage })),
);
const DocsPage = lazy(() =>
	import("./routes/docs-page").then((module) => ({ default: module.DocsPage })),
);
const FeedbackPage = lazy(() =>
	import("./routes/feedback-page").then((module) => ({ default: module.FeedbackPage })),
);
const HomePage = lazy(() =>
	import("./routes/home-page").then((module) => ({ default: module.HomePage })),
);
const MapPage = lazy(() =>
	import("./routes/map-page").then((module) => ({ default: module.MapPage })),
);
const AccountPage = lazy(() =>
	import("./routes/account-page").then((module) => ({ default: module.AccountPage })),
);
const AccountActionModule = () => import("./routes/account-action-page");
const AccountLoginPage = lazy(() =>
	AccountActionModule().then((module) => ({
		default: () => <module.AccountActionPage kind="login" />,
	})),
);
const AccountRegisterPage = lazy(() =>
	AccountActionModule().then((module) => ({
		default: () => <module.AccountActionPage kind="register" />,
	})),
);
const AccountForgotPasswordPage = lazy(() =>
	AccountActionModule().then((module) => ({
		default: () => <module.AccountActionPage kind="forgot-password" />,
	})),
);
const AccountResetPasswordPage = lazy(() =>
	AccountActionModule().then((module) => ({
		default: () => <module.AccountActionPage kind="reset-password" />,
	})),
);
const FederationConsentPage = lazy(() =>
	AccountActionModule().then((module) => ({ default: module.FederationConsentPage })),
);
const FederationErrorPage = lazy(() =>
	AccountActionModule().then((module) => ({ default: module.FederationErrorPage })),
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

const docsRoute = createRoute({
	component: DocsPage,
	getParentRoute: () => rootRoute,
	path: "/docs/$",
});

const mapRoute = createRoute({
	component: MapPage,
	getParentRoute: () => rootRoute,
	path: "/map",
});

const diningRoute = createRoute({
	component: DiningPage,
	getParentRoute: () => rootRoute,
	path: "/dining",
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

const routeTree = rootRoute.addChildren([
	indexRoute,
	conversationRoute,
	docsRoute,
	mapRoute,
	diningRoute,
	feedbackRoute,
	accountRoute,
	accountLoginRoute,
	accountRegisterRoute,
	accountForgotPasswordRoute,
	accountResetPasswordRoute,
	accountFederationConsentRoute,
	accountFederationErrorRoute,
]);

const router = createRouter({
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
