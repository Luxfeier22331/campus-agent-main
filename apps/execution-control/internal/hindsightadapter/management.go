package hindsightadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
	"net/http"
	"strings"
)

type memoryWire struct {
	ID          string            `json:"id"`
	Text        string            `json:"text"`
	Type        string            `json:"type"`
	FactType    string            `json:"fact_type"`
	State       string            `json:"state"`
	MentionedAt *string           `json:"mentioned_at"`
	EditedAt    *string           `json:"edited_at"`
	Metadata    map[string]string `json:"metadata"`
	Sources     []memoryWire      `json:"source_memories"`
}

func memoryRecord(value any) (memoryruntime.MemoryRecord, error) {
	var wire memoryWire
	bytes, err := json.Marshal(value)
	if err != nil {
		return memoryruntime.MemoryRecord{}, err
	}
	if err = json.Unmarshal(bytes, &wire); err != nil {
		return memoryruntime.MemoryRecord{}, err
	}
	return wire.record()
}
func (w memoryWire) record() (memoryruntime.MemoryRecord, error) {
	if w.ID == "" || w.Text == "" {
		return memoryruntime.MemoryRecord{}, fmt.Errorf("invalid memory response")
	}
	kind := "fact"
	if w.Type == "" {
		w.Type = w.FactType
	}
	switch w.Type {
	case "world":
	case "experience":
		kind = "experience"
	case "observation":
		kind = "summary"
	default:
		return memoryruntime.MemoryRecord{}, fmt.Errorf("invalid memory type")
	}
	state := "active"
	if w.State == "invalidated" {
		state = "inactive"
	}
	origin := "unknown"
	switch w.Metadata["source"] {
	case "manual", "explicit_profile_memory":
		origin = "manual"
	case "user_message":
		origin = "conversation"
	}
	if kind == "summary" {
		origin = "derived"
	}
	result := memoryruntime.MemoryRecord{MemoryID: w.ID, Text: w.Text, Kind: kind, State: state, Origin: origin, MentionedAt: w.MentionedAt, EditedAt: w.EditedAt}
	for _, source := range w.Sources {
		record, err := source.record()
		if err != nil {
			return result, err
		}
		result.SourceMemories = append(result.SourceMemories, record)
	}
	return result, nil
}
func (c hindsightHTTPClient) ListMemories(ctx context.Context, bankID string, q memoryruntime.MemoryQuery) (memoryruntime.MemoryPage, error) {
	request := c.client.MemoryAPI.ListMemories(ctx, bankID).Limit(int32(q.Limit)).Offset(int32(q.Offset))
	if q.Query != "" {
		request = request.Q(q.Query)
	}
	if q.Kind != "" {
		request = request.Type_(map[string]string{"fact": "world", "experience": "experience", "summary": "observation"}[q.Kind])
	}
	state := "valid"
	if q.State == "inactive" {
		state = "invalidated"
	}
	request = request.State(state)
	body, response, err := request.Execute()
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	page := memoryruntime.MemoryPage{Items: []memoryruntime.MemoryRecord{}, Limit: q.Limit, Offset: q.Offset}
	if response != nil && response.StatusCode == http.StatusNotFound {
		return page, nil
	}
	if err != nil {
		return page, err
	}
	if err = requireHindsightSuccess(response, "list memories"); err != nil {
		return page, err
	}
	if body == nil {
		return page, fmt.Errorf("missing memory page")
	}
	page.Total = int(body.GetTotal())
	for _, item := range body.GetItems() {
		record, err := memoryRecord(item)
		if err != nil {
			return page, err
		}
		page.Items = append(page.Items, record)
	}
	return page, nil
}
func (c hindsightHTTPClient) GetMemory(ctx context.Context, bankID, memoryID string) (memoryruntime.MemoryRecord, error) {
	body, response, err := c.client.MemoryAPI.GetMemory(ctx, bankID, memoryID).Execute()
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if response != nil && response.StatusCode == http.StatusNotFound {
		return memoryruntime.MemoryRecord{}, memoryruntime.ErrMemoryNotFound
	}
	if err != nil {
		return memoryruntime.MemoryRecord{}, err
	}
	if err = requireHindsightSuccess(response, "get memory"); err != nil {
		return memoryruntime.MemoryRecord{}, err
	}
	return memoryRecord(body)
}
func (c hindsightHTTPClient) UpdateMemory(ctx context.Context, bankID, memoryID string, edit memoryruntime.PersonalMemoryCommandItem) error {
	payload := hindsight.NewUpdateMemoryRequest()
	if edit.Text != "" {
		payload.SetText(strings.TrimSpace(edit.Text))
	}
	if edit.State != "" {
		state := "valid"
		if edit.State == "inactive" {
			state = "invalidated"
		}
		payload.SetState(state)
	}
	_, response, err := c.client.MemoryAPI.UpdateMemory(ctx, bankID, memoryID).UpdateMemoryRequest(*payload).Execute()
	if response != nil && response.Body != nil {
		defer func() { _ = response.Body.Close() }()
	}
	if response != nil && response.StatusCode == http.StatusNotFound {
		return memoryruntime.ErrMemoryNotFound
	}
	if response != nil && response.StatusCode == http.StatusBadRequest {
		return memoryruntime.ErrMemoryEditRejected
	}
	if err != nil {
		return err
	}
	return requireHindsightSuccess(response, "update memory")
}
func (e hindsightExecutor) ListMemories(ctx context.Context, q memoryruntime.MemoryQuery) (memoryruntime.MemoryPage, error) {
	return e.client.ListMemories(ctx, e.scopedBankIDForGeneration(q.TenantID, q.OwnerUserID, q.OwnerGeneration), q)
}
func (e hindsightExecutor) GetMemory(ctx context.Context, q memoryruntime.MemoryQuery) (memoryruntime.MemoryRecord, error) {
	return e.client.GetMemory(ctx, e.scopedBankIDForGeneration(q.TenantID, q.OwnerUserID, q.OwnerGeneration), q.MemoryID)
}
