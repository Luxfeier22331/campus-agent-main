import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";

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
              <Typography variant="h5">需要受保护访问</Typography>
              <Typography color="text.secondary" variant="body1">
                当前面板请求缺少有效的 Cloudflare Access 会话，或现有会话已经过期。
                请重新从受保护域名进入，以恢复可信运维身份。
              </Typography>
              <Stack direction={{ sm: "row", xs: "column" }} spacing={1.5}>
                <Button component="a" href="/" variant="contained">
                  重新进入面板
                </Button>
                <Button component="a" href="/cdn-cgi/access/logout" variant="text">
                  退出 Access 会话
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
  );
}
