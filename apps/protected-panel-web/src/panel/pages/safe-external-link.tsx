import { Link as MuiLink } from "@mui/material";

import { normalizeSafeExternalHref } from "../panel-safe-links";

export function SafeExternalLink(props: { unsafeHref: string | null; label: string }) {
	const safeHref = normalizeSafeExternalHref(props.unsafeHref);
	if (!safeHref) {
		return null;
	}

	return (
		<MuiLink href={safeHref} rel="noopener noreferrer" target="_blank">
			{props.label}
		</MuiLink>
	);
}
