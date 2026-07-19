import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRouter, campusRouter } from "./app/router";
import { getCampusRuntimeConfig } from "./platform/runtime/config";
import {
	CampusSentryErrorBoundary,
	campusReactErrorHandler,
	initializeCampusBrowserSentry,
} from "./platform/telemetry/sentry-browser-loader";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Campus root element was not found.");
}

const runtimeConfig = getCampusRuntimeConfig();
void initializeCampusBrowserSentry(runtimeConfig.sentry, campusRouter).catch(() => undefined);

createRoot(rootElement, {
	onRecoverableError: campusReactErrorHandler(),
	onUncaughtError: campusReactErrorHandler(),
}).render(
	<StrictMode>
		<CampusSentryErrorBoundary fallback={<ApplicationFailure />}>
			<AppRouter />
		</CampusSentryErrorBoundary>
	</StrictMode>,
);

function ApplicationFailure() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="max-w-md text-center">
				<h1 className="text-xl font-semibold">页面暂时无法显示</h1>
				<p className="mt-2 text-sm text-muted-foreground">请刷新页面后重试。</p>
				<button
					className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
					onClick={() => window.location.reload()}
					type="button"
				>
					刷新
				</button>
			</div>
		</main>
	);
}
