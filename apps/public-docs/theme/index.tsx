import "./docs-ui.css";
import { useFrontmatter, usePageData } from "@rspress/core/runtime";
import { type LayoutProps, Layout as OriginalLayout } from "@rspress/core/theme-original";
import { useEffect } from "react";

export * from "@rspress/core/theme-original";

const READER_LAYOUT_CLASSES = [
	"docs-reader-layout-landing",
	"docs-reader-layout-article",
	"docs-reader-layout-reference",
	"docs-reader-layout-tabular",
	"docs-reader-layout-graph",
	"docs-reader-measure-standard",
	"docs-reader-measure-wide",
	"docs-reader-measure-full",
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
	const readerLayout = resolveReaderLayout(stringField(frontmatter, "readerLayout"), routePath);
	const readerMeasure = resolveReaderMeasure(stringField(frontmatter, "readerMeasure"), routePath);
	return [`docs-reader-layout-${readerLayout}`, `docs-reader-measure-${readerMeasure}`];
}

function resolveReaderLayout(value: string | undefined, routePath: string): string {
	if (
		value === "landing" ||
		value === "article" ||
		value === "reference" ||
		value === "tabular" ||
		value === "graph"
	) {
		return value;
	}
	if (routePath === "/" || routePath.endsWith("/index") || routePath.endsWith("/index.html")) {
		return "landing";
	}
	if (routePath.includes("/curriculum-plan/") && !routePath.endsWith("/curriculum-plan/")) {
		return "tabular";
	}
	if (routePath.includes("/student-handbook/workflows/")) {
		return "graph";
	}
	return "reference";
}

function resolveReaderMeasure(value: string | undefined, routePath: string): string {
	if (value === "standard" || value === "wide" || value === "full") {
		return value;
	}
	if (routePath === "/" || routePath.endsWith("/index") || routePath.endsWith("/index.html")) {
		return "standard";
	}
	if (routePath.includes("/student-handbook/workflows/")) {
		return "full";
	}
	return "wide";
}

function useDocsReaderLayoutClass(): void {
	const { frontmatter: rawFrontmatter } = useFrontmatter();
	const {
		page: { routePath },
	} = usePageData();
	const frontmatter = asRecord(rawFrontmatter);
	const readerLayout = stringField(frontmatter, "readerLayout");
	const readerMeasure = stringField(frontmatter, "readerMeasure");

	useEffect(() => {
		const docRoot = document.querySelector(".rspress-doc");
		if (!docRoot) {
			return;
		}
		docRoot.classList.remove(...READER_LAYOUT_CLASSES);
		docRoot.classList.add(
			...resolveReaderLayoutClasses({ readerLayout, readerMeasure }, routePath),
		);
		return () => {
			docRoot.classList.remove(...READER_LAYOUT_CLASSES);
		};
	}, [readerLayout, readerMeasure, routePath]);
}

export function Layout(props: LayoutProps) {
	useDocsReaderLayoutClass();
	return <OriginalLayout {...props} />;
}
