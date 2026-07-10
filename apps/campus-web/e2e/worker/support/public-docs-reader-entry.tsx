import React from "react";
import { createRoot } from "react-dom/client";
import DocsAccountEntry from "../../components/docs/docs-account-entry";
import DocsContentEnhancer from "../../components/docs/docs-content-enhancer";
import MobileSidebarGuard from "../../components/docs/mobile-sidebar-guard";
import ReaderStateEnhancer from "../../components/docs/reader-state-enhancer";

const rootElement = document.getElementById("docs-reader-enhancer-root");

if (!rootElement) {
	throw new Error("docs reader enhancer root is missing");
}

createRoot(rootElement).render(
	<React.StrictMode>
		<DocsAccountEntry />
		<DocsContentEnhancer />
		<MobileSidebarGuard />
		<ReaderStateEnhancer />
	</React.StrictMode>,
);
