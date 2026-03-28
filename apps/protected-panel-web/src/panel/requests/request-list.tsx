import {
  Alert,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
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

import type { RequestProjectionRecord } from "../types";
import { formatDuration } from "./request-formatters";
import {
  RequestActorSummary,
  RequestPreviewText,
  RequestScopeSummary,
  RequestStatusChip,
  RequestSurfaceLabel,
} from "./request-presenters";

const requestFilters = [
  <TextInput alwaysOn key="requestId" label="Request ID" source="requestId" />,
  <SelectInput
    choices={[
      { id: "accepted", name: "Accepted" },
      { id: "completed", name: "Completed" },
      { id: "needs_clarification", name: "Needs clarification" },
      { id: "no_answer", name: "No answer" },
      { id: "error", name: "Error" },
    ]}
    emptyText="All statuses"
    key="status"
    label="Status"
    source="status"
  />,
  <TextInput key="surface" label="Surface" source="surface" />,
  <TextInput key="conversationId" label="Conversation" source="conversationId" />,
];

function RequestListAside() {
  return (
    <Card sx={{ width: { lg: 320, xs: "100%" } }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Query semantics</Typography>
          <Alert severity="info">
            Requests reads the app-api owned request projection snapshot. It does not replay
            the answer runtime or inspect raw logs.
          </Alert>
          <Typography color="text.secondary" variant="body2">
            Pagination is cursor-backed. Move forward sequentially with Next page; direct
            page jumps intentionally fail closed when the cursor chain is unavailable.
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Newly completed chat requests can appear a moment later while the projector
            materializes the read model.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function RequestListEmpty() {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">No requests yet</Typography>
          <Typography color="text.secondary" variant="body2">
            This table only shows request projections already materialized by app-api.
            Freshly accepted chat traffic can remain briefly absent until projection catches up.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function RequestListPage() {
  return (
    <List
      aside={<RequestListAside />}
      emptyWhileLoading
      empty={<RequestListEmpty />}
      filters={requestFilters}
      perPage={20}
      sort={{ field: "startedAt", order: "DESC" }}
      title="Requests"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="Request" source="requestId" />
        <FunctionField
          label="Actor"
          render={(record: RequestProjectionRecord) => <RequestActorSummary record={record} />}
        />
        <FunctionField
          label="Surface"
          render={(record: RequestProjectionRecord) => (
            <RequestSurfaceLabel surface={record.surface} />
          )}
        />
        <FunctionField
          label="Status"
          render={(record: RequestProjectionRecord) => (
            <RequestStatusChip status={record.status} />
          )}
        />
        <FunctionField
          label="Capability"
          render={(record: RequestProjectionRecord) =>
            record.requestedCapability || "Unspecified"
          }
        />
        <FunctionField
          label="Scope"
          render={(record: RequestProjectionRecord) => <RequestScopeSummary record={record} />}
        />
        <FunctionField
          label="Question"
          render={(record: RequestProjectionRecord) => (
            <RequestPreviewText
              emptyText="No question preview captured."
              text={record.questionPreview}
            />
          )}
        />
        <FunctionField
          label="Duration"
          render={(record: RequestProjectionRecord) => formatDuration(record.durationMs)}
        />
        <DateField label="Started" showTime source="startedAt" />
        <ShowButton />
      </Datagrid>
    </List>
  );
}
