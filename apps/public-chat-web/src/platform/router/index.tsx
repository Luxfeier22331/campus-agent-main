import { Link as RouterLink, useLocation, useNavigate } from "@tanstack/react-router";
import { type AnchorHTMLAttributes, forwardRef, type ReactNode, useMemo } from "react";

export type AppHref =
	| string
	| {
			hash?: string;
			pathname: string;
			query?: Record<string, boolean | number | string | null | undefined>;
	  };

type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	children: ReactNode;
	href: AppHref;
	replace?: boolean;
};

function resolveHref(href: AppHref): string {
	if (typeof href === "string") {
		return href;
	}

	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(href.query ?? {})) {
		if (value === null || value === undefined) {
			continue;
		}
		params.set(key, String(value));
	}

	const search = params.toString();
	return `${href.pathname}${search ? `?${search}` : ""}${href.hash ?? ""}`;
}

function isExternalHref(href: string) {
	return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:");
}

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(props, ref) {
	const { children, href, replace, ...rest } = props;
	const resolvedHref = resolveHref(href);

	if (isExternalHref(resolvedHref)) {
		return (
			<a href={resolvedHref} ref={ref} {...rest}>
				{children}
			</a>
		);
	}

	return (
		<RouterLink ref={ref} replace={replace} to={resolvedHref} {...rest}>
			{children}
		</RouterLink>
	);
});

export function useAppRouter() {
	const navigate = useNavigate();

	return useMemo(
		() => ({
			back() {
				window.history.back();
			},
			forward() {
				window.history.forward();
			},
			async push(href: AppHref) {
				await navigate({ to: resolveHref(href) });
			},
			refresh() {
				window.location.reload();
			},
			async replace(href: AppHref) {
				await navigate({ replace: true, to: resolveHref(href) });
			},
		}),
		[navigate],
	);
}

export function useAppPathname() {
	return useLocation({
		select: (location) => location.pathname,
	});
}

export function useConversationRouteId() {
	const pathname = useAppPathname();
	const match = pathname.match(/^\/chat\/([^/?#]+)/);
	return match?.[1];
}
