import type { SourceItemPayload } from "@/features/conversation/model";

interface Node {
	type: string;
	value?: string;
	url?: string;
	children?: Node[];
	data?: { hName: string; hProperties: Record<string, string> };
	position?: { start: { offset?: number }; end: { offset?: number } };
}
const numbers = /^[0-9]+(?:[ \t]*,[ \t]*[0-9]+)*$/;
const marker = /\[([0-9]+(?:[ \t]*,[ \t]*[0-9]+)*)\]/g;
function matchesSource(source: SourceItemPayload | undefined, href: string | undefined): boolean {
	const target = source?.primaryAction.href;
	if (!(target && href)) {
		return false;
	}
	if (target === href) {
		return true;
	}
	if (source.kind !== "campus_document" || !href.startsWith("/docs/")) {
		return false;
	}
	const actual = new URL(href, "https://campus.invalid");
	const expected = new URL(target, "https://campus.invalid");
	// Reader highlighting identifies the passage, not a different document destination.
	actual.searchParams.delete("hl");
	expected.searchParams.delete("hl");
	return actual.href === expected.href;
}
function citations(label: string): Node[] {
	return [...new Set(label.split(",").map((value) => Number(value.trim())))].map((index) => ({
		type: "link",
		url: `#citation-${index}`,
		children: [{ type: "text", value: String(index) }],
		data: { hName: "a", hProperties: { "data-citation-index": String(index) } },
	}));
}
export function remarkCitations(sources: ReadonlyMap<number, SourceItemPayload> = new Map()) {
	return (tree: Node, file: { value?: unknown }) => {
		const markdown = String(file.value ?? "");
		function walk(node: Node) {
			if (
				!node.children ||
				["code", "inlineCode", "html", "image", "imageReference", "linkReference"].includes(
					node.type,
				)
			) {
				return;
			}
			node.children = node.children.flatMap((child): Node[] => {
				if (child.type === "link") {
					const label =
						child.children?.map((part) => (part.type === "text" ? part.value : "")).join("") ?? "";
					const matched =
						numbers.test(label) &&
						label
							.split(",")
							.every((value) => matchesSource(sources.get(Number(value.trim())), child.url));
					return matched ? citations(label) : [child];
				}
				if (child.type !== "text") {
					walk(child);
					return [child];
				}
				const value = child.value ?? "";
				const raw = markdown.slice(child.position?.start.offset, child.position?.end.offset);
				let rawCursor = 0;
				const parts: Node[] = [];
				let cursor = 0;
				for (const match of value.matchAll(marker)) {
					const rawIndex = raw.indexOf(match[0], rawCursor);
					if (rawIndex < 0) {
						continue;
					}
					rawCursor = rawIndex + match[0].length;
					let escapes = 0;
					while (raw[rawIndex - escapes - 1] === "\\") {
						escapes++;
					}
					if (escapes % 2) {
						continue;
					}
					parts.push(
						{ type: "text", value: value.slice(cursor, match.index) },
						...citations(match[1] ?? ""),
					);
					cursor = match.index + match[0].length;
				}
				return cursor ? [...parts, { type: "text", value: value.slice(cursor) }] : [child];
			});
		}
		walk(tree);
	};
}
