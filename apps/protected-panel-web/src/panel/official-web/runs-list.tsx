import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import {
  Datagrid,
  DateField,
  FunctionField,
  List,
  SelectInput,
  ShowButton,
  TextField,
  TextInput,
} from "react-admin";

import type { OfficialWebRunRecord } from "../types";
import {
  OfficialWebFailureSummary,
  OfficialWebIngestionStatusChip,
  OfficialWebRunIntentChip,
  OfficialWebRunStatusChip,
} from "./official-web-presenters";

const runFilters = [
  <TextInput alwaysOn key="siteId" label="Site ID" source="siteId" />,
  <SelectInput
    choices={[
      { id: "baseline", name: "Baseline" },
      { id: "hot", name: "Hot" },
      { id: "repair", name: "Repair" },
    ]}
    emptyText="All intents"
    key="runIntent"
    label="Intent"
    source="runIntent"
  />,
  <SelectInput
    choices={[
      { id: "accepted", name: "Accepted" },
      { id: "running", name: "Running" },
      { id: "completed", name: "Completed" },
      { id: "completed_with_errors", name: "Completed with errors" },
      { id: "failed", name: "Failed" },
      { id: "abandoned", name: "Abandoned" },
    ]}
    emptyText="All statuses"
    key="status"
    label="Status"
    source="status"
  />,
  <SelectInput
    choices={[
      { id: "pending", name: "Pending" },
      { id: "queued", name: "Queued" },
      { id: "dispatched", name: "Dispatched" },
      { id: "ingestion_failed", name: "Dispatch failed" },
    ]}
    emptyText="All dispatch states"
    key="ingestionDispatchStatus"
    label="Dispatch"
    source="ingestionDispatchStatus"
  />,
];

function OfficialWebRunsAside() {
  return (
    <Card sx={{ width: { lg: 320, xs: "100%" } }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Read model notes</Typography>
          <Alert severity="info">
            Crawl runs reads app-api owned projections. Cursor pagination is sequential by design and
            does not bypass the runtime seam.
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function OfficialWebRunsListPage() {
  return (
    <List
      aside={<OfficialWebRunsAside />}
      emptyWhileLoading
      filters={runFilters}
      perPage={20}
      sort={{ field: "startedAt", order: "DESC" }}
      title="Official Web Crawl Runs"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="Run ID" source="runId" />
        <TextField label="Site" source="siteId" />
        <FunctionField
          label="Intent"
          render={(record: OfficialWebRunRecord) => <OfficialWebRunIntentChip runIntent={record.runIntent} />}
        />
        <FunctionField
          label="Status"
          render={(record: OfficialWebRunRecord) => <OfficialWebRunStatusChip status={record.status} />}
        />
        <FunctionField
          label="Dispatch"
          render={(record: OfficialWebRunRecord) => (
            <OfficialWebIngestionStatusChip status={record.ingestionDispatchStatus} />
          )}
        />
        <FunctionField
          label="Failures"
          render={(record: OfficialWebRunRecord) => <OfficialWebFailureSummary record={record} />}
        />
        <DateField label="Started" showTime source="startedAt" />
        <DateField label="Finished" showTime source="finishedAt" />
        <ShowButton />
      </Datagrid>
    </List>
  );
}
