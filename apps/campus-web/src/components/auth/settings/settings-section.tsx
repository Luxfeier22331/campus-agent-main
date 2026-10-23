import { Alert, AlertDescription, Button } from "@campus-agent/ui";
import { type ReactNode, useId } from "react";
import { readCampusAuthErrorMessage } from "@/platform/auth/client";

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
	const id = useId();
	return (
		<section aria-labelledby={id} className="min-w-0">
			<h2 className="ui-section-title mb-4" id={id}>
				{title}
			</h2>
			{children}
		</section>
	);
}

export function SettingsFeedback({
	error,
	success,
	onRetry,
}: {
	error?: unknown;
	success?: string | undefined;
	onRetry?: (() => void) | undefined;
}) {
	if (error) {
		return (
			<Alert tone="danger">
				<AlertDescription>
					{typeof error === "string" ? error : readCampusAuthErrorMessage(error)}
				</AlertDescription>
				{onRetry ? (
					<Button className="mt-3" variant="outline" onClick={onRetry}>
						重试
					</Button>
				) : null}
			</Alert>
		);
	}
	return success ? (
		<Alert role="status" tone="success">
			<AlertDescription>{success}</AlertDescription>
		</Alert>
	) : null;
}
