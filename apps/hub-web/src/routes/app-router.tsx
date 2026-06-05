import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";

import {
	AccountActionPage,
	FederationConsentPage,
	FederationErrorPage,
} from "./account-action-page";
import { AccountPage } from "./account-page";
import { LauncherPage } from "./launcher-page";
import { NotFoundPage, RootRouteComponent } from "./route-layout";

const rootRoute = createRootRoute({
	component: RootRouteComponent,
	notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
	component: LauncherPage,
	getParentRoute: () => rootRoute,
	path: "/",
});

const accountRoute = createRoute({
	component: AccountPage,
	getParentRoute: () => rootRoute,
	path: "/account",
});

const accountLoginRoute = createRoute({
	component: () => <AccountActionPage kind="login" />,
	getParentRoute: () => rootRoute,
	path: "/account/login",
});

const accountRegisterRoute = createRoute({
	component: () => <AccountActionPage kind="register" />,
	getParentRoute: () => rootRoute,
	path: "/account/register",
});

const accountForgotPasswordRoute = createRoute({
	component: () => <AccountActionPage kind="forgot-password" />,
	getParentRoute: () => rootRoute,
	path: "/account/forgot-password",
});

const accountResetPasswordRoute = createRoute({
	component: () => <AccountActionPage kind="reset-password" />,
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
