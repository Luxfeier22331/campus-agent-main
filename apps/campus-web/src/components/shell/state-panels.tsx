import { Card } from "@/components/ui/card";

export function LoadingPanel({ label = "正在加载" }: { label?: string }) {
	return (
		<Card className="p-6 text-sm text-[var(--sys-text-muted)]" role="status">
			{label}
		</Card>
	);
}

export function ErrorPanel({ message }: { message: string }) {
	return (
		<Card className="border-[var(--state-error-border)] bg-[var(--state-error-bg)] p-6 text-sm text-[var(--sys-status-danger)]">
			{message}
		</Card>
	);
}

export function EmptyPanel({ message }: { message: string }) {
	return <Card className="p-6 text-sm text-[var(--sys-text-muted)]">{message}</Card>;
}
