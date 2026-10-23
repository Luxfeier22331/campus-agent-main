import { Link, useRouterState } from "@tanstack/react-router";
export function UserLink({ userId }: { userId: string }) {
	const from = useRouterState({ select: (state) => state.location.href });
	return (
		<Link
			to="/users/$userId"
			params={{ userId }}
			search={{ from }}
			className="break-all text-info underline"
		>
			{userId}
		</Link>
	);
}
