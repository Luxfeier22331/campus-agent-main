import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { Box, Card, CardContent, Stack, Typography } from "@mui/material";

export function AccessRequiredPage() {
  return (
    <Box
      sx={{
        alignItems: "center",
        display: "flex",
        justifyContent: "center",
        minHeight: "100dvh",
        p: 3,
      }}
    >
      <Card sx={{ maxWidth: 520, width: "100%" }}>
        <CardContent>
          <Stack spacing={2}>
            <LockOutlinedIcon color="primary" fontSize="large" />
            <Typography variant="h5">Protected access required</Typography>
            <Typography color="text.secondary" variant="body1">
              This panel does not own a local login flow. Re-enter through the upstream
              protected hostname so Cloudflare Access can attach a trusted operator identity.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
