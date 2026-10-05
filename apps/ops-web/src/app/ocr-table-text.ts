// OCR providers sometimes emit escaped line breaks and a LaTeX arrow inside HTML cells.
// Transform only rendered cell text; the stored Markdown and embedding input remain untouched.
interface Node {
	type: string;
	tagName?: string;
	value?: string;
	children?: Node[];
	properties?: Record<string, unknown>;
}
export function ocrTableText() {
	return (tree: Node) => {
		function visit(node: Node, cell = false) {
			if (node.tagName === "code" || node.tagName === "pre") {
				return;
			}
			const inside = cell || node.tagName === "td" || node.tagName === "th";
			if (!node.children) {
				return;
			}
			node.children = node.children.flatMap((child) => {
				if (inside && child.type === "text" && child.value) {
					const text = child.value.replace(/\$\s*\\rightarrow\s*\$/g, "→");
					return text
						.split(/\\n/)
						.flatMap((value, i): Node[] => [
							...(i ? [{ type: "element", tagName: "br", properties: {}, children: [] }] : []),
							{ type: "text", value },
						]);
				}
				visit(child, inside);
				return [child];
			});
		}
		visit(tree);
	};
}
