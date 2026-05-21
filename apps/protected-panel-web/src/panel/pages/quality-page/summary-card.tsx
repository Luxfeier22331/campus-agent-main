import { Card, CardContent, Stack, Typography } from "@mui/material";

export interface QualitySummaryCardProps {
	detail: string;
	label: string;
	value: string;
}

export function SummaryCard(props: QualitySummaryCardProps) {
	return (
		<Card
			sx={{
				backgroundColor: "background.paper",
				borderRadius: 2,
			}}
			variant="outlined"
		>
			<CardContent>
				<Stack spacing={1}>
					<Typography color="text.secondary" variant="body2">
						{props.label}
					</Typography>
					<Typography sx={{ fontWeight: 700 }} variant="h5">
						{props.value}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						{props.detail}
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}
