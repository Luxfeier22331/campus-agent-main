import { useAppPathname, useAppRouter, type AppHref } from "@platform/router";

import { normalizeDonorAppHref } from "../router-normalization";

export function useRouter() {
  const router = useAppRouter();

  return {
    back: router.back,
    forward: router.forward,
    async prefetch(_href: AppHref) {},
    async push(href: AppHref) {
      await router.push(normalizeDonorAppHref(href));
    },
    refresh: router.refresh,
    async replace(href: AppHref) {
      await router.replace(normalizeDonorAppHref(href));
    },
  };
}

export function usePathname() {
  return useAppPathname();
}
