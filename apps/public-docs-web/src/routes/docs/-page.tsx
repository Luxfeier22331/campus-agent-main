import { notFound } from "@tanstack/react-router";
import browserCollections from "collections/browser";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { type ComponentType, Suspense } from "react";
import { useMDXComponents } from "@/components/mdx";
import { docsManifest, getDocsPageEntry } from "@/lib/docs-manifest";
import type { DocsManifestPageEntry } from "@/lib/docs-manifest.shared";
import { baseOptions } from "@/lib/layout.shared";
import { gitConfig } from "@/lib/shared";

function DocsMdxContent(props: {
	MDX: ComponentType<{
		components: ReturnType<typeof useMDXComponents>;
	}>;
}) {
	const components = useMDXComponents();

	return <props.MDX components={components} />;
}

const clientLoader = browserCollections.docs.createClientLoader({
	component(
		{ toc, frontmatter, default: MDX },
		page: {
			markdownUrl: string;
			path: string;
		},
	) {
		return (
			<DocsPage toc={toc}>
				<DocsTitle>{frontmatter.title}</DocsTitle>
				<DocsDescription>{frontmatter.description}</DocsDescription>
				<div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
					<MarkdownCopyButton markdownUrl={page.markdownUrl} />
					<ViewOptionsPopover
						markdownUrl={page.markdownUrl}
						githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/public-docs-web/content/docs/${page.path}`}
					/>
				</div>
				<DocsBody>
					<DocsMdxContent MDX={MDX} />
				</DocsBody>
			</DocsPage>
		);
	},
});

export async function loadDocsPage(slugs: string[]) {
	const page = getDocsPageEntry(slugs);

	if (!page) {
		throw notFound();
	}

	await clientLoader.preload(page.path);

	return page;
}

export function DocsPageScreen({ page }: { page: DocsManifestPageEntry }) {
	return (
		<DocsLayout {...baseOptions()} tree={docsManifest.pageTree}>
			<Suspense>{clientLoader.useContent(page.path, page)}</Suspense>
		</DocsLayout>
	);
}
