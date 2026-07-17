import type { AuthView } from "@better-auth-ui/core";
import { Auth as BetterAuthHeroUIAuth } from "@better-auth-ui/heroui";

import { ProductBrandLink } from "@/components/navigation/product-navigation";
import { CampusAuthUIProvider } from "./auth-ui-provider";
import "./auth-styles.css";

export type CampusAuthView = AuthView;

export function AuthPanel({
	className = "mx-auto w-full max-w-sm",
	view,
}: {
	className?: string;
	view?: CampusAuthView;
}) {
	return <BetterAuthHeroUIAuth className={className} view={view} />;
}

export function Auth({ view }: { view?: CampusAuthView }) {
	return (
		<CampusAuthUIProvider>
			<section
				aria-label="account-auth-layout"
				className="flex min-h-dvh flex-col items-center px-4 pb-10 pt-8 sm:pt-10"
				data-campus-account-surface="auth"
			>
				<ProductBrandLink className="mb-8 w-full max-w-sm" />
				<AuthPanel view={view} />
			</section>
		</CampusAuthUIProvider>
	);
}
