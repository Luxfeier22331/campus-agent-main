import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import GatedReaderBootstrap from "../../components/docs/gated-reader-bootstrap";
import ReaderStateEnhancer from "../../components/docs/reader-state-enhancer";
import { onSearch, render as renderSearchResults } from "../../docs/search/rspress-search-hooks";

const rootElement = document.getElementById("gated-docs-bootstrap-root");

if (!rootElement) {
	throw new Error("gated docs bootstrap root is missing");
}

createRoot(rootElement).render(
	<React.StrictMode>
		<GatedReaderBootstrap />
		<ReaderStateEnhancer />
		<DocsSearchHarness />
	</React.StrictMode>,
);

function DocsSearchHarness() {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<unknown[]>([]);

	async function runSearch() {
		const groups = await onSearch(query, []);
		if (!Array.isArray(groups)) {
			setResults([]);
			return;
		}
		setResults(groups.flatMap((group) => (Array.isArray(group.result) ? group.result : [])));
	}

	return (
		<form
			aria-label="文档搜索"
			onSubmit={(event) => {
				event.preventDefault();
				void runSearch();
			}}
		>
			<label>
				搜索文档
				<input
					aria-label="搜索文档"
					onChange={(event) => setQuery(event.currentTarget.value)}
					value={query}
				/>
			</label>
			<button type="submit">搜索</button>
			{renderSearchResults(results as never)}
		</form>
	);
}
