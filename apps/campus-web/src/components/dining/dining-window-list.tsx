import { Button, cn, StateMessage } from "@campus-agent/ui";
import type { DiningWindowProjection } from "@/features/dining/model";

export function DiningWindowList(props: {
	className?: string;
	matchedWindowIds: ReadonlySet<string> | null;
	onSelectWindow(windowId: string): void;
	selectedWindowId: string | null;
	title: string;
	windows: DiningWindowProjection[];
}) {
	const visibleWindows =
		props.matchedWindowIds === null
			? props.windows
			: props.windows.filter((window) => props.matchedWindowIds?.has(window.windowId));
	return (
		<div className={props.className}>
			<p className="text-xs font-medium text-[var(--sys-text-subtle)]">{props.title}</p>
			{visibleWindows.length > 0 ? (
				<ul className="mt-2 grid min-w-0 list-none grid-cols-2 gap-1 p-0 sm:grid-cols-3">
					{visibleWindows.map((window) => {
						const selected = window.windowId === props.selectedWindowId;
						return (
							<li className="min-w-0" key={window.windowId}>
								<Button
									aria-pressed={selected}
									className={cn(
										"min-h-11 w-full min-w-0 justify-start border border-border px-3 text-left",
										selected &&
											"border-border-selected bg-selected text-selected-foreground hover:bg-selected-hover",
									)}
									onClick={() => props.onSelectWindow(window.windowId)}
									variant="ghost"
								>
									<span className="truncate">{window.name}</span>
								</Button>
							</li>
						);
					})}
				</ul>
			) : (
				<StateMessage
					layout="inline"
					className="py-4"
					description={
						props.windows.length > 0
							? "本层没有匹配的窗口，可从搜索结果选择其他楼层，或清除搜索。"
							: "当前楼层暂无窗口"
					}
				/>
			)}
		</div>
	);
}
