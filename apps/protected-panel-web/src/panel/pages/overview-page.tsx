import { useEffect, useEffectEvent, useState, startTransition } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import type { PanelOverviewRecord } from "../types";

function renderDomainStatus(status: string) {
  if (status === "ready") {
    return <Chip color="success" label="Ready" size="small" />;
  }
  if (status === "deferred") {
    return <Chip color="warning" label="Deferred" size="small" variant="outlined" />;
  }

  return <Chip color="default" label="Blocked" size="small" variant="outlined" />;
}

export function OverviewPage() {
  useAuthenticated();
  const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [record, setRecord] = useState<PanelOverviewRecord | null>(null);

  const loadOverview = useEffectEvent(async () => {
    startTransition(() => {
      setError(null);
      setIsLoading(true);
    });

    try {
      const response = await dataProvider.getOverview();
      startTransition(() => {
        setRecord(response.data);
        setIsLoading(false);
      });
    } catch (loadError) {
      startTransition(() => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load panel overview.");
        setIsLoading(false);
      });
    }
  });

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4">Overview</Typography>
          <Typography color="text.secondary" variant="body1">
            Protected operator control plane status for the Worker shell and its app-api
            query seam.
          </Typography>
        </Stack>

        {isLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }}>
            <CircularProgress />
          </Stack>
        ) : null}

        {!isLoading && error ? <Alert severity="error">{error}</Alert> : null}

        {!isLoading && record ? (
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                lg: "repeat(2, minmax(0, 1fr))",
                xs: "1fr",
              },
            }}
          >
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">Runtime</Typography>
                  <Divider />
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      <strong>App</strong>: {record.appName}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Surface</strong>: {record.surface}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Runtime</strong>: {record.runtime}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Protected Hostname</strong>: {record.protectedHostname || "Not set"}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Protection Envelope</strong>: {record.protectionEnvelope}
                    </Typography>
                    <Typography variant="body2">
                      <strong>App API Base URL</strong>: {record.runtimeApiBaseUrl || "Bound via Worker service binding"}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">Operator Context</Typography>
                  <Divider />
                  {record.operatorContext ? (
                    <Stack spacing={1}>
                      <Typography variant="body2">
                        <strong>Operator ID</strong>: {record.operatorContext.operatorId}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Display Name</strong>: {record.operatorContext.displayName || "Not provided"}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Email</strong>: {record.operatorContext.email || "Not provided"}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Principal Class</strong>: {record.operatorContext.principalClass}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Groups</strong>:{" "}
                        {record.operatorContext.groups.length > 0
                          ? record.operatorContext.groups.join(", ")
                          : "No groups projected"}
                      </Typography>
                    </Stack>
                  ) : (
                    <Alert severity="info">
                      Upstream protected access is required before the panel projects operator
                      identity into the overview surface.
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">Domain Rollout</Typography>
                  <Divider />
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.5,
                      gridTemplateColumns: {
                        md: "repeat(3, minmax(0, 1fr))",
                        xs: "1fr",
                      },
                    }}
                  >
                    {Object.entries(record.panelDomains).map(([domain, status]) => (
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        key={domain}
                        spacing={2}
                        sx={{ alignItems: "center" }}
                      >
                        <Typography sx={{ textTransform: "capitalize" }} variant="body2">
                          {domain}
                        </Typography>
                        {renderDomainStatus(status)}
                      </Stack>
                    ))}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
