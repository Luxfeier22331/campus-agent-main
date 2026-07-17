package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) handlePersonalMemoryCommand(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var command memoryruntime.PersonalMemoryCommandRequest
	if err := json.Unmarshal(body, &command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Personal memory command is invalid.", false)
		return
	}
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	if s.temporalStarter == nil || s.temporalStarterErr != nil {
		setOutcome(response, "temporal_not_ready")
		writeError(response, http.StatusServiceUnavailable, "temporal_not_ready", "Temporal workflow admission is unavailable.", true)
		return
	}
	workflowID := "campus-agent.memory.command." + strings.TrimSpace(command.CommandID)
	if err := s.temporalStarter.StartPersonalMemoryCommandWorkflow(
		request.Context(),
		temporalruntime.PersonalMemoryCommandWorkflowInput{Command: command, WorkflowID: workflowID},
	); err != nil {
		setOutcome(response, "temporal_admission_failed")
		writeError(response, http.StatusServiceUnavailable, "temporal_admission_failed", "Personal memory workflow admission failed.", true)
		return
	}
	setOutcome(response, "personal_memory_command_admitted")
	writeJSON(response, http.StatusAccepted, map[string]any{
		"command_id":  command.CommandID,
		"status":      "admitted",
		"workflow_id": workflowID,
	})
}
