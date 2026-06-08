import { Send } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";

export function ChatComposer({
	disabled,
	onSubmit,
	placeholder = "今天需要什么帮助",
}: {
	disabled?: boolean;
	onSubmit(prompt: string): void;
	placeholder?: string;
}) {
	const [prompt, setPrompt] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();
		const value = prompt.trim();
		if (!value || disabled) {
			return;
		}
		onSubmit(value);
		setPrompt("");
	}

	return (
		<form
			className="rounded-2xl border border-border bg-white p-2 shadow-[var(--shadow-sm)]"
			onSubmit={handleSubmit}
		>
			<div className="flex items-end gap-2">
				<textarea
					className="max-h-40 min-h-14 flex-1 resize-none rounded-xl border-0 bg-transparent px-3 py-3 text-base outline-none placeholder:text-[var(--sys-text-subtle)]"
					disabled={disabled}
					onChange={(event) => setPrompt(event.target.value)}
					placeholder={placeholder}
					value={prompt}
				/>
				<Button
					aria-label="发送"
					className="size-12 shrink-0 p-0"
					disabled={disabled || !prompt.trim()}
				>
					<Send aria-hidden="true" className="size-5" />
				</Button>
			</div>
		</form>
	);
}
