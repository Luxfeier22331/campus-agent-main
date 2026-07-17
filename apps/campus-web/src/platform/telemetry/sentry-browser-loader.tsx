import { Component, type ErrorInfo, type ReactNode } from "react";

import type { CampusRuntimeConfig } from "../runtime/config";

type SentryBrowserModule = typeof import("./sentry-browser");

let modulePromise: Promise<SentryBrowserModule> | null = null;

function loadSentryBrowser(): Promise<SentryBrowserModule> {
	if (!modulePromise) {
		modulePromise = import("./sentry-browser");
	}
	return modulePromise;
}

export async function initializeCampusBrowserSentry(
	config: Pick<CampusRuntimeConfig["sentry"], "dsn" | "environment" | "release">,
	router: unknown,
): Promise<boolean> {
	if (!config.dsn) {
		return false;
	}
	return (await loadSentryBrowser()).initializeCampusBrowserSentry(config, router);
}

export function campusReactErrorHandler() {
	return (error: unknown, errorInfo: ErrorInfo) => {
		void loadSentryBrowser().then((sentry) => sentry.campusReactErrorHandler()(error, errorInfo));
	};
}

export function runCampusWebBrowserSentryCanary(
	input: CampusRuntimeConfig["sentry"],
): Promise<import("./sentry-browser").CampusWebBrowserSentryCanaryEvidence | null> {
	if (!input.dsn) {
		return Promise.resolve(null);
	}
	return loadSentryBrowser().then((sentry) => sentry.runCampusWebBrowserSentryCanary(input));
}

export class CampusSentryErrorBoundary extends Component<
	{ children: ReactNode; fallback: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		void loadSentryBrowser().then((sentry) => sentry.campusReactErrorHandler()(error, errorInfo));
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
