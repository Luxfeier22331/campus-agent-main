import "./docs-ui.css";
import { useFrontmatter, usePageData } from "@rspress/core/runtime";
import { type LayoutProps, Layout as OriginalLayout } from "@rspress/core/theme-original";
import { useEffect } from "react";

export * from "@rspress/core/theme-original";

const READER_LAYOUT_CLASSES = [
	"docs-reader-normal",
	"docs-reader-wide",
	"docs-reader-map",
	"docs-reader-home",
];

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveReaderLayoutClasses(
	frontmatter: Record<string, unknown>,
	routePath: string,
): string[] {
	const readerProfile = stringField(frontmatter, "readerProfile");
	if (readerProfile === "home" || readerProfile === "collectionLanding") {
		return ["docs-reader-home"];
	}
	if (readerProfile === "curriculum") {
		return ["docs-reader-wide", "docs-reader-map"];
	}
	if (readerProfile === "flow") {
		return ["docs-reader-wide"];
	}
	if (readerProfile === "manual") {
		return ["docs-reader-normal"];
	}

	if (routePath === "/" || routePath.endsWith("/index") || routePath.endsWith("/index.html")) {
		return ["docs-reader-home"];
	}
	if (routePath.includes("/curriculum-plan/") && !routePath.endsWith("/curriculum-plan/")) {
		return ["docs-reader-wide", "docs-reader-map"];
	}
	if (routePath.includes("/student-handbook/workflows/")) {
		return ["docs-reader-wide"];
	}
	return ["docs-reader-normal"];
}

function useDocsReaderLayoutClass(): void {
	const { frontmatter: rawFrontmatter } = useFrontmatter();
	const {
		page: { routePath },
	} = usePageData();
	const frontmatter = asRecord(rawFrontmatter);
	const readerProfile = stringField(frontmatter, "readerProfile");

	useEffect(() => {
		const docRoot = document.querySelector(".rspress-doc");
		if (!docRoot) {
			return;
		}
		docRoot.classList.remove(...READER_LAYOUT_CLASSES);
		docRoot.classList.add(...resolveReaderLayoutClasses({ readerProfile }, routePath));
		return () => {
			docRoot.classList.remove(...READER_LAYOUT_CLASSES);
		};
	}, [readerProfile, routePath]);
}

export function Layout(props: LayoutProps) {
	useDocsReaderLayoutClass();
	return <OriginalLayout {...props} />;
}
