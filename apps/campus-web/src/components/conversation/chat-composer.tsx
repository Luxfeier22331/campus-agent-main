import { ArrowUp } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ChatComposer({
	clearOnSubmit = true,
	disabled,
	initialPrompt = "",
	onSubmit,
	placeholder = "今天需要什么帮助",
	variant = "thread",
}: {
	clearOnSubmit?: boolean;
	disabled?: boolean;
	initialPrompt?: string;
	onSubmit(prompt: string): void;
	placeholder?: string;
	variant?: "hero" | "thread";
}) {
	const [prompt, setPrompt] = useState(initialPrompt);

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		const value = prompt.trim();
		if (!value || disabled) {
			return;
		}
		onSubmit(value);
		if (clearOnSubmit) {
			setPrompt("");
		}
	}

	return (
		<form
			className={cn(
				"border border-[var(--input-border)] bg-white p-2 shadow-[var(--shadow-xs)]",
				variant === "hero" ? "rounded-[26px] p-3" : "rounded-[22px]",
			)}
			onSubmit={handleSubmit}
		>
			<div className="flex items-end gap-2">
				<textarea
					className={cn(
						"max-h-40 flex-1 resize-none border-0 bg-transparent px-3 py-3 text-base outline-none placeholder:text-[var(--sys-text-subtle)]",
						variant === "hero" ? "min-h-24" : "min-h-14",
					)}
					disabled={disabled}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder={placeholder}
					value={prompt}
				/>
				<Button
					aria-label="发送"
					className="size-10 shrink-0 rounded-full bg-[var(--sys-text-strong)] p-0 text-white hover:bg-[var(--sys-text-default)] disabled:bg-[var(--state-disabled-bg)]"
					disabled={disabled || !prompt.trim()}
					variant="ghost"
					type="submit"
				>
					<ArrowUp aria-hidden="true" className="size-5" />
				</Button>
			</div>
		</form>
	);
}
