import { TooltipProvider } from "@campus-agent/ui";
import { InternalPortalAutomationSection } from "./internal-portal-automation-section";
import { InternalPortalCredentialsSection } from "./internal-portal-credentials-section";

export function InternalPortalPage() {
	return (
		<TooltipProvider>
			<InternalPortalCredentialsSection />
			<InternalPortalAutomationSection />
		</TooltipProvider>
	);
}
