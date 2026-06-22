import { AuthView, type AuthViewPaths } from "better-auth-ui";

export type CampusAuthView = keyof AuthViewPaths;

export function Auth({ view }: { view?: CampusAuthView }) {
	return (
		<section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-center px-5 py-10">
			<div className="w-full">
				<AuthView
					className="mx-auto w-full rounded-lg border border-border bg-card shadow-[var(--shadow-xs)]"
					view={view}
				/>
			</div>
		</section>
	);
}
