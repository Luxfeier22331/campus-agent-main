import { Dialog, DialogContent, DialogTitle } from "@campus-agent/ui";
import { useState } from "react";
import type { FeedbackCategory } from "@/features/feedback/model";
import { useCampusSession } from "@/platform/auth/session";
import { FeedbackForm } from "./feedback-form";

export interface FeedbackSheetProps {
	defaultCategory?: FeedbackCategory;
	onOpenChange(open: boolean): void;
	open: boolean;
	sourceLabel: string;
}

export function FeedbackSheet({
	defaultCategory = "content_issue",
	onOpenChange,
	open,
	sourceLabel,
}: FeedbackSheetProps) {
	const [routeContext] = useState(() => window.location.pathname + window.location.search);
	const session = useCampusSession();
	const sessionContact = session.status === "authenticated" ? session.data?.user.email : null;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent
				aria-describedby={undefined}
				onOpenAutoFocus={(event) => {
					// Focus the description field: the body is the main input, and focusing
					// the Select trigger instead lets it swallow the first Escape press.
					event.preventDefault();
					document.getElementById("feedback-body")?.focus();
				}}
			>
				<DialogTitle className="mb-5 text-xl">反馈</DialogTitle>
				<FeedbackForm
					defaultCategory={defaultCategory}
					onDone={() => onOpenChange(false)}
					routeContext={routeContext}
					sessionContact={sessionContact}
					sourceLabel={sourceLabel}
				/>
			</DialogContent>
		</Dialog>
	);
}
