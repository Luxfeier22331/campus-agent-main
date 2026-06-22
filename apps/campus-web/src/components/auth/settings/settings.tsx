import { AccountView, type AccountViewPath } from "better-auth-ui";

export function Settings({ view }: { view?: AccountViewPath }) {
	return (
		<section className="mx-auto min-h-[calc(100dvh-4rem)] max-w-5xl px-5 py-8 lg:px-8">
			<AccountView
				className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]"
				view={view}
			/>
		</section>
	);
}
