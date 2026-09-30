import { TooltipProvider } from "@campus-agent/ui";
import { InternalPortalAutomationSection } from "./internal-portal-automation-section";
import { InternalPortalCredentialsSection } from "./internal-portal-credentials-section";
import { PageHeader } from "./ops-display";

export function InternalPortalPage() {
	return (
		<TooltipProvider>
			<section className="min-w-0">
				<PageHeader title="内部门户" description="管理采集凭据和开发者自动化访问。" />
				<nav aria-label="内部门户分区" className="mb-5 flex flex-wrap gap-4 text-sm">
					<a
						className="inline-flex min-h-11 items-center text-link hover:underline"
						href="#portal-credentials"
					>
						凭据池
					</a>
					<a
						className="inline-flex min-h-11 items-center text-link hover:underline"
						href="#portal-automation"
					>
						自动化访问
					</a>
				</nav>
				<div id="portal-credentials" className="min-w-0 scroll-mt-24">
					<InternalPortalCredentialsSection />
				</div>
				<InternalPortalAutomationSection />
			</section>
		</TooltipProvider>
	);
}
