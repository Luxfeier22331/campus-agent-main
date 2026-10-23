import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownPreview({ children }: { children: string }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			allowedElements={["p"]}
			unwrapDisallowed
			skipHtml
			components={{ p: ({ children }) => <span>{children} </span> }}
		>
			{children}
		</ReactMarkdown>
	);
}
