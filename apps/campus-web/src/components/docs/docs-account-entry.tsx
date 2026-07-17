import { lazy, Suspense, useState } from "react";

import { campusAuthClient } from "@/platform/auth/client";

const DocsAuthenticatedAccount = lazy(() =>
	import("./docs-authenticated-account").then((module) => ({
		default: module.DocsAuthenticatedAccount,
	})),
);
const DocsAuthDialog = lazy(() =>
	import("./docs-auth-dialog").then((module) => ({ default: module.DocsAuthDialog })),
);

export default function DocsAccountEntry() {
	const [open, setOpen] = useState(false);
	const session = campusAuthClient.useSession();

	return (
		<div className="docs-account-entry-mount">
			{session.isPending ? <DocsAccountButton disabled label="账号" /> : null}
			{!session.isPending && session.data ? (
				<Suspense fallback={<DocsAccountButton disabled label="账号" />}>
					<DocsAuthenticatedAccount />
				</Suspense>
			) : null}
			{session.isPending || session.data ? null : (
				<DocsAccountButton
					ariaLabel="登录查看账号可见文档"
					label="登录"
					onClick={() => setOpen(true)}
				/>
			)}
			{open ? (
				<Suspense fallback={null}>
					<DocsAuthDialog onOpenChange={setOpen} open redirectTo={readDocsCurrentRouteTarget()} />
				</Suspense>
			) : null}
		</div>
	);
}

function DocsAccountButton({
	ariaLabel,
	disabled = false,
	label,
	onClick,
}: {
	ariaLabel?: string;
	disabled?: boolean;
	label: string;
	onClick?: () => void;
}) {
	return (
		<button
			aria-label={ariaLabel ?? label}
			className="docs-account-entry-button"
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			{label}
		</button>
	);
}

function readDocsCurrentRouteTarget(): string {
	if (typeof window === "undefined") {
		return "/docs";
	}
	return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}
