import { ThemeProvider } from "@campus-agent/ui";
import { Component, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRouter } from "./app/router";
import { CampusSessionProvider } from "./platform/auth/session";
import { getCampusRuntimeConfig } from "./platform/runtime/config";
import "./app-styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Campus root element was not found.");
}

getCampusRuntimeConfig();

class CampusErrorBoundary extends Component<
	{ children: ReactNode; fallback: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}

createRoot(rootElement).render(
	<StrictMode>
		<ThemeProvider>
			<CampusErrorBoundary fallback={<ApplicationFailure />}>
				<CampusSessionProvider>
					<AppRouter />
				</CampusSessionProvider>
			</CampusErrorBoundary>
		</ThemeProvider>
	</StrictMode>,
);

function ApplicationFailure() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="max-w-md text-center">
				<h1 className="text-xl font-semibold">页面暂时无法显示</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					应用遇到意外错误，重新打开页面可以恢复当前界面。
				</p>
				<button
					className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed"
					onClick={() => window.location.reload()}
					type="button"
				>
					重新打开
				</button>
			</div>
		</main>
	);
}
