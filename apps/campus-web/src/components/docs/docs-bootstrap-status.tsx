import type { ReactNode } from "react";

import { SurfaceState } from "@/components/ui/surface-state";

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
	return (
		<SurfaceState
			className="reader-bootstrap-status max-w-2xl"
			description={description}
			kind={resolveSurfaceStateKind(kind)}
			primaryAction={action}
			title={title}
		/>
	);
}

function resolveSurfaceStateKind(kind: DocsBootstrapStatusKind): "error" | "info" | "loading" {
	if (kind === "loading") {
		return "loading";
	}
	return kind === "unauthorized" ? "info" : "error";
}
