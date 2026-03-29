import PendingActionsOutlinedIcon from "@mui/icons-material/PendingActionsOutlined";
import { Alert, Box, Card, CardContent, Stack, Typography } from "@mui/material";

interface DelayedDomainPageProps {
  domain: string;
  reason: string;
}

export function DelayedDomainPage({ domain, reason }: DelayedDomainPageProps) {
  return (
    <Box sx={{ p: 3 }}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5}>
              <PendingActionsOutlinedIcon color="action" />
              <Typography variant="h5">{domain}</Typography>
            </Stack>
            <Alert severity="info">
              {domain} remains intentionally delayed in the current rollout.
            </Alert>
            <Typography color="text.secondary" variant="body1">
              {reason}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
