import "./docs-ui.css";
import { usePageData } from "@rspress/core/runtime";
import { type LayoutProps, Layout as OriginalLayout } from "@rspress/core/theme-original";
import { useEffect } from "react";

export * from "@rspress/core/theme-original";

const READER_LAYOUT_CLASSES = ["docs-reader-normal", "docs-reader-wide", "docs-reader-map"];

function resolveReaderLayoutClasses(routePath: string): string[] {
	if (routePath.includes("/curriculum-plan/") && !routePath.endsWith("/curriculum-plan/")) {
		return ["docs-reader-wide", "docs-reader-map"];
	}
	if (routePath.includes("/student-handbook/workflows/")) {
		return ["docs-reader-wide"];
	}
	return ["docs-reader-normal"];
}

function useDocsReaderLayoutClass(): void {
	const {
		page: { routePath },
	} = usePageData();

	useEffect(() => {
		const docRoot = document.querySelector(".rspress-doc");
		if (!docRoot) {
			return;
		}
		docRoot.classList.remove(...READER_LAYOUT_CLASSES);
		docRoot.classList.add(...resolveReaderLayoutClasses(routePath));
		return () => {
			docRoot.classList.remove(...READER_LAYOUT_CLASSES);
		};
	}, [routePath]);
}

export function Layout(props: LayoutProps) {
	useDocsReaderLayoutClass();
	return <OriginalLayout {...props} />;
}
