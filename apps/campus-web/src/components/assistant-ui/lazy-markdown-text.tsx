import { Component, type ErrorInfo, lazy, type ReactNode, Suspense } from "react";

const MarkdownText = lazy(() =>
	import("./markdown-text").then((module) => ({ default: module.MarkdownText })),
);

interface MarkdownTextErrorBoundaryProps {
	resetKey?: string | undefined;
	children: ReactNode;
}

interface MarkdownTextErrorBoundaryState {
	error: Error | null;
	resetKey: string | undefined;
}

export class MarkdownTextErrorBoundary extends Component<
	MarkdownTextErrorBoundaryProps,
	MarkdownTextErrorBoundaryState
> {
	override state: MarkdownTextErrorBoundaryState = { error: null, resetKey: undefined };

	static getDerivedStateFromError(error: Error): Partial<MarkdownTextErrorBoundaryState> {
		return { error };
	}

	static getDerivedStateFromProps(
		props: MarkdownTextErrorBoundaryProps,
		state: MarkdownTextErrorBoundaryState,
	): Partial<MarkdownTextErrorBoundaryState> | null {
		if (props.resetKey === state.resetKey) {
			return null;
		}
		return state.error === null
			? { resetKey: props.resetKey }
			: { error: null, resetKey: props.resetKey };
	}

	override componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[lazy-markdown-text] markdown render failed", error, info.componentStack);
	}

	override render() {
		if (this.state.error !== null) {
			return (
				<p
					data-slot="aui_markdown-error"
					className="text-destructive bg-destructive/10 my-3 rounded-md border border-destructive/40 px-3 py-2 text-sm"
				>
					回答内容渲染失败
				</p>
			);
		}
		return this.props.children;
	}
}

export function LazyMarkdownText({ resetKey }: { resetKey?: string | undefined }) {
	return (
		<MarkdownTextErrorBoundary resetKey={resetKey}>
			<Suspense
				fallback={
					<span
						aria-hidden="true"
						className="inline-block h-4 w-24 animate-pulse rounded bg-surface-muted motion-reduce:animate-none"
					/>
				}
			>
				<MarkdownText />
			</Suspense>
		</MarkdownTextErrorBoundary>
	);
}
