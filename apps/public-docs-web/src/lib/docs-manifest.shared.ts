import { docsContentRoute, docsRoute } from "./shared";

export interface DocsTreePageNode {
	type: "page";
	name: string;
	url: string;
	description?: string;
}

export interface DocsTreeFolderNode {
	type: "folder";
	name: string;
	description?: string;
	root?: boolean;
	defaultOpen?: boolean;
	index?: DocsTreePageNode;
	children: DocsTreeNode[];
}

export interface DocsTreeRootNode {
	type: "root";
	name: string;
	children: DocsTreeNode[];
}

export type DocsTreeNode = DocsTreePageNode | DocsTreeFolderNode;

export interface DocsManifestPageEntry {
	description?: string;
	isIndex: boolean;
	markdownUrl: string;
	path: string;
	routePath: string;
	routeSegments: string[];
	title: string;
}

export interface DocsManifest {
	pageByRoute: Record<string, DocsManifestPageEntry>;
	pageTree: DocsTreeRootNode;
	prerenderRoutes: string[];
}

interface Frontmatter {
	description?: string;
	title?: string;
}

interface InternalFolder {
	children: Map<string, InternalFolder>;
	description?: string;
	indexPage?: DocsManifestPageEntry;
	name: string;
	pages: DocsManifestPageEntry[];
	segment: string;
}

export function normalizeDocFilePath(filePath: string) {
	const normalizedPath = filePath.replace(/\\/g, "/");
	const withoutExtension = normalizedPath.replace(/\.(md|mdx)$/u, "");
	const segments = withoutExtension.split("/").filter(Boolean);
	const isIndex = segments.at(-1) === "index";
	const routeSegments = isIndex ? segments.slice(0, -1) : segments;
	const routePath =
		routeSegments.length === 0 ? docsRoute : `${docsRoute}/${routeSegments.join("/")}`;
	const markdownPath =
		routeSegments.length === 0 ? "content.md" : `${routeSegments.join("/")}/content.md`;

	return {
		isIndex,
		normalizedPath,
		routePath,
		routeSegments,
		markdownUrl: `${docsContentRoute}/${markdownPath}`,
	};
}

export function buildDocsManifestFromFiles(files: Record<string, string>): DocsManifest {
	const folders = new Map<string, InternalFolder>();
	const rootFolder = createFolder("");
	const pageEntries = Object.entries(files)
		.map(([filePath, raw]) => createPageEntry(filePath, raw))
		.sort((a, b) => a.routePath.localeCompare(b.routePath, "zh-CN"));

	for (const entry of pageEntries) {
		if (entry.routeSegments.length === 0) {
			rootFolder.indexPage = entry;
			rootFolder.name = entry.title;
			rootFolder.description = entry.description;
			continue;
		}

		const folderPath = entry.isIndex ? entry.routeSegments : entry.routeSegments.slice(0, -1);
		const folder = ensureFolder(rootFolder, folders, folderPath);

		if (entry.isIndex) {
			folder.indexPage = entry;
			folder.name = entry.title;
			folder.description = entry.description;
		} else {
			folder.pages.push(entry);
		}
	}

	const pageByRoute = Object.fromEntries(pageEntries.map((entry) => [entry.routePath, entry]));
	const prerenderRoutes = pageEntries.map((entry) => entry.routePath);

	return {
		pageByRoute,
		pageTree: {
			type: "root",
			name: rootFolder.name,
			children: buildFolderChildren(rootFolder, true),
		},
		prerenderRoutes,
	};
}

function createPageEntry(filePath: string, raw: string): DocsManifestPageEntry {
	const { frontmatter, body } = parseFrontmatter(raw);
	const normalized = normalizeDocFilePath(filePath);

	return {
		description: frontmatter.description,
		isIndex: normalized.isIndex,
		markdownUrl: normalized.markdownUrl,
		path: normalized.normalizedPath,
		routePath: normalized.routePath,
		routeSegments: normalized.routeSegments,
		title:
			frontmatter.title ??
			extractMarkdownTitle(body) ??
			humanizeSegment(normalized.routeSegments.at(-1) ?? "文档"),
	};
}

function parseFrontmatter(raw: string): { body: string; frontmatter: Frontmatter } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);

	if (!match) {
		return { body: raw, frontmatter: {} };
	}

	const frontmatter: Frontmatter = {};

	for (const line of match[1].split(/\r?\n/u)) {
		const separatorIndex = line.indexOf(":");
		if (separatorIndex < 0) continue;

		const key = line.slice(0, separatorIndex).trim();
		const value = line
			.slice(separatorIndex + 1)
			.trim()
			.replace(/^['"]|['"]$/gu, "");

		if (key === "title" || key === "description") {
			frontmatter[key] = value;
		}
	}

	return {
		body: raw.slice(match[0].length),
		frontmatter,
	};
}

function extractMarkdownTitle(body: string) {
	for (const line of body.split(/\r?\n/u)) {
		const match = line.match(/^#\s+(.+)$/u);
		if (match) {
			return match[1].trim();
		}
	}

	return undefined;
}

function createFolder(segment: string): InternalFolder {
	return {
		children: new Map<string, InternalFolder>(),
		name: segment ? humanizeSegment(segment) : "文档目录",
		pages: [],
		segment,
	};
}

function ensureFolder(
	rootFolder: InternalFolder,
	folders: Map<string, InternalFolder>,
	pathSegments: string[],
) {
	let current = rootFolder;
	const traversed: string[] = [];

	for (const segment of pathSegments) {
		traversed.push(segment);
		const key = traversed.join("/");
		let folder = folders.get(key);

		if (!folder) {
			folder = createFolder(segment);
			folders.set(key, folder);
			current.children.set(segment, folder);
		}

		current = folder;
	}

	return current;
}

function buildFolderChildren(folder: InternalFolder, isRoot = false): DocsTreeNode[] {
	const children: DocsTreeNode[] = [];

	if (isRoot && folder.indexPage) {
		children.push(toPageNode(folder.indexPage));
	}

	for (const childFolder of sortFolders(folder.children.values())) {
		const folderNode: DocsTreeFolderNode = {
			type: "folder",
			name: childFolder.indexPage?.title ?? childFolder.name,
			children: buildFolderChildren(childFolder),
		};

		if (childFolder.description) {
			folderNode.description = childFolder.description;
		}

		if (childFolder.indexPage) {
			folderNode.index = toPageNode(childFolder.indexPage);
		}

		if (isRoot) {
			folderNode.root = true;
			folderNode.defaultOpen = true;
		}

		children.push(folderNode);
	}

	for (const page of sortPages(folder.pages)) {
		children.push(toPageNode(page));
	}

	return children;
}

function sortFolders(folders: Iterable<InternalFolder>) {
	return [...folders].sort((a, b) => {
		const aName = a.indexPage?.title ?? a.name;
		const bName = b.indexPage?.title ?? b.name;

		return aName.localeCompare(bName, "zh-CN");
	});
}

function sortPages(pages: DocsManifestPageEntry[]) {
	return [...pages].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

function toPageNode(page: DocsManifestPageEntry): DocsTreePageNode {
	return {
		type: "page",
		name: page.title,
		url: page.routePath,
		description: page.description,
	};
}

function humanizeSegment(segment: string) {
	return segment
		.split("-")
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ");
}
