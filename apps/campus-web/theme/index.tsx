import "./docs-ui.css";
import { useFrontmatter, usePageData } from "@rspress/core/runtime";
import {
	getCustomMDXComponent,
	type LayoutProps,
	Layout as OriginalLayout,
} from "@rspress/core/theme-original";
import { isValidElement, type ReactNode } from "react";

import DocsAccountEntry from "@/components/docs/docs-account-entry";
import {
	ReaderAnchor,
	ReaderBlock,
	ReaderDocument,
	ReaderDocumentMeta,
	ReaderMarkdownTable,
	ReaderPermalink,
	ReaderTable,
} from "@/components/docs/reader-components";

export * from "@rspress/core/theme-original";

const originalComponents = getCustomMDXComponent();

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveReaderLayout(
	value: string | undefined,
	routePath: string,
): "article" | "landing" | "reference" | "tabular" {
	if (value === "landing" || value === "article" || value === "reference" || value === "tabular") {
		return value;
	}
	if (routePath === "/" || routePath.endsWith("/index") || routePath.endsWith("/index.html")) {
		return "landing";
	}
	if (routePath.includes("/curriculum/") || routePath.includes("/curriculum_plan/")) {
		return "tabular";
	}
	return "reference";
}

function resolveReaderMeasure(
	value: string | undefined,
	routePath: string,
): "full" | "standard" | "wide" {
	if (value === "standard" || value === "wide" || value === "full") {
		return value;
	}
	if (routePath === "/" || routePath.endsWith("/index") || routePath.endsWith("/index.html")) {
		return "standard";
	}
	return "wide";
}

function ReaderMdxDocument({ children }: { children: ReactNode }) {
	const { frontmatter: rawFrontmatter } = useFrontmatter();
	const {
		page: { routePath },
	} = usePageData();
	const frontmatter = asRecord(rawFrontmatter);
	return (
		<ReaderDocument
			layout={resolveReaderLayout(stringField(frontmatter, "readerLayout"), routePath)}
			measure={resolveReaderMeasure(stringField(frontmatter, "readerMeasure"), routePath)}
			permalinkRootUnitIds={stringRecord(frontmatter.readerPermalinks)}
		>
			{children}
		</ReaderDocument>
	);
}

export function Layout(props: LayoutProps) {
	return (
		<OriginalLayout
			{...props}
			afterNavMenu={
				<>
					{props.afterNavMenu}
					<DocsAccountEntry />
				</>
			}
			components={{
				...props.components,
				ReaderAnchor,
				ReaderBlock,
				ReaderDocumentMeta,
				ReaderTable,
				h1: ReaderH1,
				h2: ReaderH2,
				h3: ReaderH3,
				h4: ReaderH4,
				h5: ReaderH5,
				h6: ReaderH6,
				table: ReaderMarkdownTable,
				wrapper: ReaderMdxDocument,
			}}
		/>
	);
}

const ReaderH1 = createReaderHeading(originalComponents.h1);
const ReaderH2 = createReaderHeading(originalComponents.h2);
const ReaderH3 = createReaderHeading(originalComponents.h3);
const ReaderH4 = createReaderHeading(originalComponents.h4);
const ReaderH5 = createReaderHeading(originalComponents.h5);
const ReaderH6 = createReaderHeading(originalComponents.h6);

function createReaderHeading(Heading: (props: React.ComponentProps<"h1">) => React.JSX.Element) {
	return function ReaderMdxHeading(props: React.ComponentProps<"h1">) {
		const title = readHeadingText(props.children);
		return (
			<div className="docs-reader-heading-row">
				<Heading {...props} aria-label={props["aria-label"] ?? (title || undefined)}>
					{props.children}
				</Heading>
				{props.id && title ? <ReaderPermalink anchor={props.id} title={title} /> : null}
			</div>
		);
	};
}

function readHeadingText(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map(readHeadingText).join("").replace(/\s+/gu, " ").trim();
	}
	if (!isValidElement<{ children?: ReactNode; className?: string }>(node)) {
		return "";
	}
	if (
		node.type === ReaderPermalink ||
		node.props.className?.includes("rp-header-anchor") ||
		node.props.className?.includes("docs-reader-heading-actions")
	) {
		return "";
	}
	return readHeadingText(node.props.children);
}

function stringRecord(value: unknown): Record<string, string> {
	const record = asRecord(value);
	return Object.fromEntries(
		Object.entries(record).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]),
		),
	);
}
