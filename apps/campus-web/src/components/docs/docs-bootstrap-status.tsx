import type { ReactNode } from "react";

type DocsBootstrapStatusKind = "loading" | "not_found" | "unauthorized" | "unavailable";

interface DocsBootstrapStatusProps {
	action?: ReactNode;
	description?: ReactNode;
	kind: DocsBootstrapStatusKind;
	title: string;
}

export function DocsBootstrapStatus({
	action,
	description,
	kind,
	title,
}: DocsBootstrapStatusProps) {
	const role = kind === "loading" ? "status" : "alert";
	return (
		<div
			aria-busy={kind === "loading" ? true : undefined}
			className={`reader-bootstrap-status reader-bootstrap-status-${kind}`}
			role={role}
		>
			<h1>{title}</h1>
			{description ? <p>{description}</p> : null}
			{action ? <div className="reader-bootstrap-status-actions">{action}</div> : null}
		</div>
	);
}
