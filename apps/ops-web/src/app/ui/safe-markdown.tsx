import { cn } from "@campus-agent/ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function SafeMarkdown({ children }: { children: string }) {
	return (
		<ReactMarkdown
			components={{
				h1: (props) => <h1 {...props} className="mt-6 mb-3 text-xl font-semibold first:mt-0" />,
				h2: (props) => <h2 {...props} className="mt-5 mb-2 text-lg font-semibold first:mt-0" />,
				h3: (props) => <h3 {...props} className="mt-4 mb-2 text-base font-semibold first:mt-0" />,
				h4: (props) => <h4 {...props} className="mt-4 mb-2 text-base font-medium first:mt-0" />,
				h5: (props) => <h5 {...props} className="mt-3 mb-1 text-sm font-semibold first:mt-0" />,
				h6: (props) => <h6 {...props} className="mt-3 mb-1 text-sm font-medium first:mt-0" />,
				blockquote: (props) => (
					<blockquote
						{...props}
						className="my-4 border-l-2 border-border pl-4 text-muted-foreground"
					/>
				),
				hr: (props) => <hr {...props} className="my-5 border-border" />,
				table: (props) => (
					<section
						aria-label="表格"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: 横向滚动区域必须可聚焦，以便键盘读取全部内容。
						tabIndex={0}
						className="my-4 max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<table {...props} className="w-full border-collapse text-sm" />
					</section>
				),
				th: (props) => (
					<th
						{...props}
						className="border border-border bg-secondary px-3 py-2 text-start font-semibold"
					/>
				),
				td: (props) => <td {...props} className="border border-border px-3 py-2 align-top" />,
				img: ({ alt, ...props }) => (
					<img {...props} alt={alt ?? ""} className="my-3 max-w-full h-auto" loading="lazy" />
				),
				a: ({ className, ...props }) => (
					<a
						{...props}
						className={cn("break-words font-medium text-info underline", className)}
						rel="noreferrer"
						target="_blank"
					/>
				),
				code: ({ className, ...props }) => (
					<code
						{...props}
						className={cn(
							"break-words rounded bg-secondary px-1 py-0.5 font-mono text-sm",
							className,
						)}
					/>
				),
				li: ({ className, ...props }) => <li {...props} className={cn("ml-5 pl-1", className)} />,
				ol: ({ className, ...props }) => (
					<ol {...props} className={cn("my-3 list-decimal space-y-1", className)} />
				),
				p: ({ className, ...props }) => (
					<p {...props} className={cn("my-3 first:mt-0 last:mb-0 leading-7", className)} />
				),
				pre: ({ className, ...props }) => (
					<section
						aria-label="代码块"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: 横向滚动区域必须可聚焦，以便键盘读取全部内容。
						tabIndex={0}
						className="my-3 max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<pre {...props} className={cn("bg-secondary p-3 text-sm", className)} />
					</section>
				),
				ul: ({ className, ...props }) => (
					<ul {...props} className={cn("my-3 list-disc space-y-1", className)} />
				),
			}}
			remarkPlugins={[remarkGfm]}
		>
			{children}
		</ReactMarkdown>
	);
}
