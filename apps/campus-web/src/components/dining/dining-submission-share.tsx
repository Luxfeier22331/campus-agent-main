import { Button, Input, Label } from "@campus-agent/ui";
import { useEffect, useId, useRef, useState } from "react";

export function DiningSubmissionShare({ submissionId }: { submissionId: string }) {
	const id = useId();
	const [result, setResult] = useState<{ copied: boolean; url: string } | null>(null);
	const [pending, setPending] = useState(false);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	async function copy() {
		const url = new URL(
			`/dining?submission=${encodeURIComponent(submissionId)}`,
			window.location.origin,
		).href;
		setPending(true);
		setResult(null);
		try {
			await navigator.clipboard.writeText(url);
			if (active.current) {
				setResult({ copied: true, url });
			}
		} catch {
			if (active.current) {
				setResult({ copied: false, url });
			}
		} finally {
			if (active.current) {
				setPending(false);
			}
		}
	}
	return (
		<div className="min-w-0 space-y-2">
			<Button variant="outline" disabled={pending} onClick={() => void copy()}>
				{pending ? "正在复制" : "复制链接"}
			</Button>
			{result ? (
				<p className="text-sm text-muted-foreground" role="status">
					{result.copied ? "链接已复制" : "无法自动复制，请手动复制下方链接。"}
				</p>
			) : null}
			{result && !result.copied ? (
				<>
					<Label htmlFor={id}>公开投稿链接</Label>
					<Input
						id={id}
						readOnly
						value={result.url}
						onFocus={(event) => event.currentTarget.select()}
					/>
				</>
			) : null}
		</div>
	);
}
