import { type AppHref, AppLink } from "@platform/router";
import { type AnchorHTMLAttributes, forwardRef, type ReactNode } from "react";

import { normalizeDonorAppHref } from "../router-normalization";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	children: ReactNode;
	href: AppHref;
	replace?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
	const { href, ...rest } = props;

	return <AppLink ref={ref} href={normalizeDonorAppHref(href)} {...rest} />;
});

export default Link;
