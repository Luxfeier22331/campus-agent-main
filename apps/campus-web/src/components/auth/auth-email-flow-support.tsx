import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function AuthStatus({
	action,
	description,
	icon,
	loading = false,
	title,
	tone = "info",
}: {
	action?: ReactNode;
	description: string;
	icon?: ReactNode;
	loading?: boolean;
	title: string;
	tone?: "danger" | "info" | "success";
}) {
	return (
		<div className="py-4 text-center">
			<div
				className={`mx-auto grid size-12 place-content-center rounded-full ${
					tone === "success"
						? "bg-success-subtle text-success"
						: tone === "danger"
							? "bg-danger-subtle text-danger"
							: "bg-info-subtle text-info"
				}`}
			>
				{loading ? <LoaderCircle className="animate-spin" /> : icon}
			</div>
			<h1 className="mt-5 text-2xl font-semibold text-[var(--sys-text-strong)]">{title}</h1>
			<p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--sys-text-muted)] [overflow-wrap:anywhere]">
				{description}
			</p>
			{action ? <div className="mt-6 flex justify-center">{action}</div> : null}
		</div>
	);
}
