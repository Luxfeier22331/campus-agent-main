import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import { useListContext } from "react-admin";

import { PANEL_COPY } from "./panel-copy";

export function PanelListErrorState(props: {
  title: string;
  description?: string;
}) {
  const { error } = useListContext();
  const message = error instanceof Error ? error.message.trim() : "";

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">{props.title}</Typography>
          {props.description ? (
            <Typography color="text.secondary" variant="body2">
              {props.description}
            </Typography>
          ) : null}
          <Alert severity="error">{message || PANEL_COPY.errorState.listLoadFailed}</Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}
