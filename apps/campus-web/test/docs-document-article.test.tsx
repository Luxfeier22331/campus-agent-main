import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsDocumentArticle } from "../src/components/docs/docs-reader-view";
import type { DocsDocumentRouteData } from "../src/features/docs/data-source";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

const DOCUMENT: DocsDocumentRouteData = {
	canonicalUrl: "/docs/regulations/institutional_rules/document-01",
	collection: "institutional_rules",
	collectionLabel: "校级规章",
	corpus: "regulations",
	courseMaps: [],
	description: "本科生专业调整实施办法",
	details: { documentNumber: "民大校发〔2025〕134号" },
	docId: "document-01",
	documentSlug: "document-01",
	kind: "document",
	reader: {
		docId: "document-01",
		elements: [
			{ kind: "paragraph", rootUnitId: "number", text: "民大校发〔2025〕134号" },
			{ anchor: "chapter-1", kind: "heading", level: 2, rootUnitId: "c1", text: "第一章 总则" },
			{
				kind: "paragraph",
				rootUnitId: "a1",
				text: "第一条　为规范专业调整，制定本办法。\n\n依照第二条办理的除外。",
			},
		],
		schemaVersion: "campus_docs_reader.v3",
		supplements: [],
		versionId: "document-01-2025",
	},
	readerUrl: "/_docs/document-01/reader.json",
	routeSlug: "document-01",
	siteIndex: createLargeDocsSiteIndex(),
	title: "本科生专业调整实施办法",
	topicId: null,
	topicLabel: null,
	versionSlug: "2025",
	versions: [],
};

describe("docs document article", () => {
	it("sets leading article numbers apart and drops the repeated document number", async () => {
		await renderArticle(DOCUMENT);

		const label = screen.getByText("第一条");
		expect(label).toHaveClass("docs-reader-article-label");
		expect(label.parentElement).toHaveTextContent("第一条 为规范专业调整，制定本办法。");
		expect(screen.getByText("依照第二条办理的除外。").querySelector("span")).toBeNull();
		const body = document.querySelector(".docs-document-body");
		expect(body).not.toHaveTextContent("民大校发〔2025〕134号");
		expect(screen.getByLabelText("文档信息与版本")).toHaveTextContent("民大校发〔2025〕134号");
	});
});

async function renderArticle(data: DocsDocumentRouteData) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const articleRoute = createRoute({
		component: () => <DocsDocumentArticle data={data} locationHref="/" />,
		getParentRoute: () => rootRoute,
		path: "/",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/"] }),
		routeTree: rootRoute.addChildren([articleRoute]),
	});
	await router.load();
	return render(<RouterProvider router={router} />);
}
