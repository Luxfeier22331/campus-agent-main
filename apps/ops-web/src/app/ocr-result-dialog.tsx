import { Dialog, DialogContent, DialogTitle, Field, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { OcrReadingSchema } from "../shared/ocr-contract";
import { ocrTableText } from "./ocr-table-text";
import { fetchJson } from "./ops-api/core";
import { ErrorState } from "./ops-display";
import { FilterSelect } from "./ui/filter-select";

export function OcrResultDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
	const pageTarget = useRef<HTMLElement | null>(null);
	const result = useQuery({
		queryKey: ["ocr", "result", url],
		enabled: url !== null,
		queryFn: async ({ signal }) => {
			if (!url) {
				throw new Error("尚未选择识别结果");
			}
			return OcrReadingSchema.parse(await fetchJson(url, { signal }));
		},
	});
	const missingImageCount = result.data?.missingImages.length ?? 0;
	return (
		<Dialog open={url !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="max-h-[85vh] overflow-y-auto sm:max-w-5xl"
				aria-describedby={undefined}
			>
				<DialogTitle>识别结果</DialogTitle>
				{result.isPending ? (
					<StateMessage layout="inline" role="status" description={<> 正在读取结果… </>} />
				) : null}
				{result.isError ? (
					<ErrorState
						error={result.error}
						onRetry={() => void result.refetch()}
						title="结果读取失败"
					/>
				) : null}
				{missingImageCount > 0 ? (
					<p className="text-sm text-warning">有 {missingImageCount} 张图片缺失，文字已保留。</p>
				) : null}
				{result.data && result.data.pages.length > 1 ? (
					<Field label={`跳转页码（共 ${result.data.pages.length} 页）`}>
						<FilterSelect
							value=""
							options={[
								{ value: "", label: "选择页码" },
								...result.data.pages.map((page) => ({
									value: String(page.index),
									label: `第 ${page.index + 1} 页`,
								})),
							]}
							onValueChange={(value) => {
								pageTarget.current = document.getElementById(`ocr-result-page-${value}`);
								pageTarget.current?.focus({ preventScroll: true });
								pageTarget.current?.scrollIntoView({ block: "start" });
							}}
							onCloseAutoFocus={(event) => {
								if (pageTarget.current) {
									event.preventDefault();
									pageTarget.current.focus({ preventScroll: true });
									pageTarget.current.scrollIntoView({ block: "start" });
									pageTarget.current = null;
								}
							}}
						/>
					</Field>
				) : null}
				{result.data?.pages.map((page) => (
					<article
						id={`ocr-result-page-${page.index}`}
						tabIndex={-1}
						key={page.index}
						className="space-y-3 overflow-auto border-t pt-4"
					>
						<h3 className="text-sm text-muted-foreground">第 {page.index + 1} 页</h3>
						<div className="prose max-w-none dark:prose-invert [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[rehypeRaw, rehypeSanitize, ocrTableText]}
								components={{
									img: ({ src, alt }) =>
										src?.startsWith("/api/ops/ocr/") ? <img src={src} alt={alt ?? ""} /> : null,
								}}
							>
								{page.markdown}
							</ReactMarkdown>
						</div>
					</article>
				))}
			</DialogContent>
		</Dialog>
	);
}
