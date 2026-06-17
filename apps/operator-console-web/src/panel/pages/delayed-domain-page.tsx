import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import { Title } from "react-admin";

import { PanelPage } from "../panel-page";

interface DelayedDomainPageProps {
	domain: string;
	reason: string;
}

export function DelayedDomainPage({ domain, reason }: DelayedDomainPageProps) {
	return (
		<>
			<Title title={domain} />
			<PanelPage>
				<Card>
					<CardContent>
						<Stack spacing={2}>
							<Stack direction="row" spacing={1.5}>
								<PendingActionsOutlinedIcon color="action" />
								<Typography variant="h5">{domain}</Typography>
							</Stack>
							<Alert severity="info">{domain} 在当前 rollout 中被有意延后。</Alert>
							<Typography color="text.secondary" variant="body1">
								{reason}
							</Typography>
						</Stack>
					</CardContent>
				</Card>
			</PanelPage>
		</>
	);
}
