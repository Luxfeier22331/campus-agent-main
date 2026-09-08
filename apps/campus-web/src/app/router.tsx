import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { DiningRoutePending } from "@/components/dining/dining-page-skeleton";
import { parseNoticeRouteSearch } from "@/features/notices/search";
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
const TransportPage = lazy(() =>
	import("./routes/transport-page").then((module) => ({ default: module.TransportPage })),
);
const InterestGroupsPage = lazy(() =>
	import("./routes/interest-groups-page").then((module) => ({
		default: module.InterestGroupsPage,
	})),
);
const NoticesPage = lazy(() =>
	import("./routes/notices-page").then((module) => ({ default: module.NoticesPage })),
);
const NoticeDetailPage = lazy(() =>
	import("./routes/notice-detail-page").then((module) => ({ default: module.NoticeDetailPage })),
);
const LazyAccountAuthPage = lazy(() =>
	import("./routes/account-page").then((module) => ({ default: module.AccountAuthPage })),
);
const LazyAccountSettingsPage = lazy(() =>
	import("./routes/account-page").then((module) => ({ default: module.AccountSettingsPage })),
);

function AccountPage() {
	return <LazyAccountSettingsPage view="account" />;
}

function AccountLoginPage() {
	return <LazyAccountAuthPage view="signIn" />;
}

function AccountRegisterPage() {
	return <LazyAccountAuthPage view="signUp" />;
}

function AccountForgotPasswordPage() {
	return <LazyAccountAuthPage view="forgotPassword" />;
}

function AccountResetPasswordPage() {
	return <LazyAccountAuthPage view="resetPassword" />;
}

function AccountResetLinkSentPage() {
	return <LazyAccountAuthPage view="resetLinkSent" />;
}

function AccountVerifyEmailPage() {
	return <LazyAccountAuthPage view="verifyEmail" />;
}

function AccountVerifyEmailResultPage() {
	return <LazyAccountAuthPage view="verifyEmailResult" />;
}

function AccountResetCompletePage() {
	return <LazyAccountAuthPage view="resetComplete" />;
}

function AccountChangePasswordPage() {
	return <LazyAccountAuthPage view="changePassword" />;
}
const AccountDeletionPage = lazy(() =>
	import("./routes/account-deletion-page").then((module) => ({
		default: module.AccountDeletionPage,
	})),
);
function AccountSettingsPage() {
	return <LazyAccountSettingsPage view="account" />;
}

function AccountSecurityPage() {
	return <LazyAccountSettingsPage view="security" />;
}

function AccountMemoryPage() {
	return <LazyAccountSettingsPage view="memory" />;
}
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

const transportRoute = createRoute({
	component: TransportPage,
	getParentRoute: () => rootRoute,
	path: "/transport",
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
		item: optionalDiningSearchParam(search.item),
		window: optionalDiningSearchParam(search.window),
	}),
});

const interestGroupsRoute = createRoute({
	component: InterestGroupsPage,
	getParentRoute: () => rootRoute,
	loader: async () => {
		const { preloadInterestGroupsRoute } = await import("@/features/interest-groups/preload");
		await preloadInterestGroupsRoute();
	},
	path: "/groups",
});

const feedbackRoute = createRoute({
	component: FeedbackPage,
	getParentRoute: () => rootRoute,
	path: "/feedback",
});

const noticesRoute = createRoute({
	component: NoticesPage,
	getParentRoute: () => rootRoute,
	path: "/notices",
	validateSearch: parseNoticeRouteSearch,
});

const noticeDetailRoute = createRoute({
	component: NoticeDetailPage,
	getParentRoute: () => rootRoute,
	path: "/notices/$noticeId",
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
	validateSearch: validateAccountRedirectSearch,
});

const accountRegisterRoute = createRoute({
	component: AccountRegisterPage,
	getParentRoute: () => rootRoute,
	path: "/account/register",
	validateSearch: (search: Record<string, unknown>) => ({
		email: optionalAuthSearchValue(search.email, 320),
		redirectTo: optionalAuthSearchValue(search.redirectTo),
	}),
});

const accountForgotPasswordRoute = createRoute({
	component: AccountForgotPasswordPage,
	getParentRoute: () => rootRoute,
	path: "/account/forgot-password",
	validateSearch: validateAccountRedirectSearch,
});

const accountResetPasswordRoute = createRoute({
	component: AccountResetPasswordPage,
	getParentRoute: () => rootRoute,
	path: "/account/reset-password",
	validateSearch: (search: Record<string, unknown>) => ({
		error: optionalAuthSearchValue(search.error, 128),
		redirectTo: optionalAuthSearchValue(search.redirectTo),
		token: optionalAuthSearchValue(search.token, 2048),
	}),
});

const accountResetLinkSentRoute = createRoute({
	component: AccountResetLinkSentPage,
	getParentRoute: () => rootRoute,
	path: "/account/reset-link-sent",
	validateSearch: validateAccountRedirectSearch,
});

const accountVerifyEmailRoute = createRoute({
	component: AccountVerifyEmailPage,
	getParentRoute: () => rootRoute,
	path: "/account/verify-email",
	validateSearch: validateAccountRedirectSearch,
});

const accountVerifyEmailResultRoute = createRoute({
	component: AccountVerifyEmailResultPage,
	getParentRoute: () => rootRoute,
	path: "/account/verify-email/result",
	validateSearch: (search: Record<string, unknown>) => ({
		error: optionalAuthSearchValue(search.error, 128),
		redirectTo: optionalAuthSearchValue(search.redirectTo),
	}),
});

const accountResetCompleteRoute = createRoute({
	component: AccountResetCompletePage,
	getParentRoute: () => rootRoute,
	path: "/account/reset-complete",
	validateSearch: validateAccountRedirectSearch,
});

const accountChangePasswordRoute = createRoute({
	component: AccountChangePasswordPage,
	getParentRoute: () => rootRoute,
	path: "/account/change-password",
	validateSearch: validateAccountRedirectSearch,
});

const accountDeletionRoute = createRoute({
	component: AccountDeletionPage,
	getParentRoute: () => rootRoute,
	path: "/account/deletion",
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
	validateSearch: (search: Record<string, unknown>) => ({
		redirectTo: optionalAccountRedirect(search.redirectTo),
	}),
});

const accountMemoryRoute = createRoute({
	component: AccountMemoryPage,
	getParentRoute: () => rootRoute,
	path: "/account/settings/memory",
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
	transportRoute,
	diningRoute,
	interestGroupsRoute,
	feedbackRoute,
	noticesRoute,
	noticeDetailRoute,
	accountRoute,
	accountLoginRoute,
	accountRegisterRoute,
	accountForgotPasswordRoute,
	accountResetPasswordRoute,
	accountResetLinkSentRoute,
	accountVerifyEmailRoute,
	accountVerifyEmailResultRoute,
	accountResetCompleteRoute,
	accountChangePasswordRoute,
	accountDeletionRoute,
	accountSettingsRoute,
	accountSecurityRoute,
	accountMemoryRoute,
	accountFederationConsentRoute,
	accountFederationErrorRoute,
	legalTermsRoute,
	legalPrivacyRoute,
]);

export const campusRouter = createRouter({
	defaultPendingComponent: RoutePending,
	defaultPendingMinMs: 200,
	defaultPendingMs: 100,
	defaultPreload: "intent",
	routeTree,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof campusRouter;
	}
}

export function AppRouter() {
	return <RouterProvider router={campusRouter} />;
}

function optionalDiningSearchParam(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalAccountRedirect(value: unknown): string | undefined {
	return optionalAuthSearchValue(value);
}

function optionalAuthSearchValue(value: unknown, maxLength = 2048): string | undefined {
	if (typeof value !== "string") {
		return;
	}
	const normalized = value.trim();
	return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function validateAccountRedirectSearch(search: Record<string, unknown>) {
	return { redirectTo: optionalAccountRedirect(search.redirectTo) };
}
