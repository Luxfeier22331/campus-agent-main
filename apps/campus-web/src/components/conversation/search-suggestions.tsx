import type { DataMessagePartProps } from "@assistant-ui/react";
export function SearchSuggestionsDataPart({
	data,
}: DataMessagePartProps<{
	type: "search_suggestions";
	provider: "google";
	renderedContent: string;
}>) {
	return (
		<iframe
			title="Google 搜索建议"
			className="mt-3 w-full border-0"
			height={160}
			sandbox="allow-popups allow-popups-to-escape-sandbox"
			referrerPolicy="no-referrer"
			srcDoc={data.renderedContent}
		/>
	);
}
