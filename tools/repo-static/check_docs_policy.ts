import { runMain } from "./run_check_group.ts";

runMain(import.meta.url, [
	{
		label: "docs frontmatter",
		script: "tools/repo-static/checks/check_docs_frontmatter_tracked.ts",
	},
	{
		label: "docs reference graph",
		script: "tools/repo-static/checks/check_docs_reference_graph_tracked.ts",
	},
]);
