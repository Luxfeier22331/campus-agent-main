import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

import { AppLink, type AppHref } from "@platform/router";

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
