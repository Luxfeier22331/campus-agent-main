import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import { Datagrid, DateField, FunctionField, List, ShowButton, TextField } from "react-admin";

import type { OfficialWebSiteRecord } from "../types";
import {
  OfficialWebHostsSummary,
  OfficialWebIngestionStatusChip,
  OfficialWebRunStatusChip,
} from "./official-web-presenters";

function OfficialWebSitesAside() {
  return (
    <Card sx={{ width: { lg: 320, xs: "100%" } }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Runtime contract</Typography>
          <Alert severity="info">
            Sites reads the app-api owned official_web site projection. It does not inspect object
            storage, queues, or ingestion-worker internals.
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function OfficialWebSitesListPage() {
  return (
    <List aside={<OfficialWebSitesAside />} emptyWhileLoading perPage={50} title="Official Web Sites">
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="Site ID" source="siteId" />
        <TextField label="Display" source="displayName" />
        <FunctionField
          label="Hosts"
          render={(record: OfficialWebSiteRecord) => (
            <OfficialWebHostsSummary hostRoots={record.hostRoots} />
          )}
        />
        <TextField label="Latest Run" source="latestRunId" />
        <FunctionField
          label="Latest Status"
          render={(record: OfficialWebSiteRecord) =>
            record.latestRunStatus ? <OfficialWebRunStatusChip status={record.latestRunStatus} /> : "No runs"
          }
        />
        <FunctionField
          label="Dispatch"
          render={(record: OfficialWebSiteRecord) => (
            <OfficialWebIngestionStatusChip status={record.latestIngestionDispatchStatus} />
          )}
        />
        <DateField label="Last Success" showTime source="lastSuccessAt" />
        <DateField label="Last Failure" showTime source="lastFailureAt" />
        <ShowButton />
      </Datagrid>
    </List>
  );
}
