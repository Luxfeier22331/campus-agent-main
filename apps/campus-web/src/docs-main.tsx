import { Button, ThemeProvider } from "@campus-agent/ui";
import { Component, type ReactNode, StrictMode, useEffect } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { createDocsRouter, DocsRouterProvider } from "./app/docs-router";

const rootElement = document.getElementById("root");
const isPrerendered = rootElement?.dataset.campusPrerendered === "docs";
const isDevelopmentShell = rootElement?.dataset.campusDocsDevelopment === "true";

if (!(rootElement && (isPrerendered || isDevelopmentShell))) {
	throw new Error("Docs root element was not found.");
}
const docsRootElement = rootElement;

const docsRouter = createDocsRouter();
if (isPrerendered) {
	// The HTML was rendered with TanStack Router's server match tree. Keep that
	// tree shape through the first client render instead of adding a root Suspense
	// boundary only in the browser.
	docsRouter.ssr = { manifest: undefined };
}
try {
	await docsRouter.load();
	const initialLoadFailed = docsRouter.state.matches.some((match) => match.status === "error");
	if (initialLoadFailed) {
		docsRootElement.dataset.campusEnhancement = "unavailable";
	} else {
		const application = (
			<StrictMode>
				<ThemeProvider>
					<DocsApplication />
				</ThemeProvider>
			</StrictMode>
		);
		if (isPrerendered) {
			hydrateRoot(docsRootElement, application);
		} else {
			createRoot(docsRootElement).render(application);
		}
	}
} catch {
	docsRootElement.dataset.campusEnhancement = "unavailable";
}

function DocsApplication() {
	useEffect(() => {
		docsRootElement.dataset.campusHydrated = "true";
	}, []);

	return (
		<DocsErrorBoundary>
			<DocsRouterProvider router={docsRouter} />
		</DocsErrorBoundary>
	);
}

class DocsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	override state = { failed: false };

	static getDerivedStateFromError(): { failed: true } {
		return { failed: true };
	}

	override render() {
		return this.state.failed ? <DocsApplicationFailure /> : this.props.children;
	}
}

function DocsApplicationFailure() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-background p-6">
			<div className="max-w-md text-center">
				<h1 className="text-xl font-semibold">页面暂时无法显示</h1>
				<p className="mt-2 text-sm text-muted-foreground">请刷新页面后重试。</p>
				<Button className="mt-5" onClick={() => window.location.reload()} type="button">
					刷新
				</Button>
			</div>
		</main>
	);
}
