import { SuggestionPrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { Button } from "@campus-agent/ui";
import { type FC, useContext } from "react";
import { ThreadSettingsContext } from "./thread-context";

export const ThreadWelcome: FC = () => {
	const { welcomeMessage } = useContext(ThreadSettingsContext);

	return (
		<div className="aui-thread-welcome-root mb-5 flex flex-col items-center px-3 text-center sm:mb-6">
			<h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-balance text-2xl font-semibold leading-8 tracking-normal duration-200 sm:text-[28px] sm:leading-9">
				{welcomeMessage}
			</h1>
		</div>
	);
};

export const ThreadSuggestions: FC = () => (
	<div className="aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-2">
		<ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
	</div>
);

const ThreadSuggestionItem: FC = () => (
	<div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
		<SuggestionPrimitive.Trigger send asChild>
			<Button
				variant="ghost"
				className="aui-thread-welcome-suggestion text-foreground hover:bg-surface-hover h-auto gap-1.5 rounded-lg border border-border/70 bg-transparent px-3 py-2 text-sm font-normal whitespace-nowrap transition-colors"
			>
				<SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
				<SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
			</Button>
		</SuggestionPrimitive.Trigger>
	</div>
);
