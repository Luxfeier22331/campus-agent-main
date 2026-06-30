package httpapi

import (
	"strings"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type hindsightHTTPClient struct {
	apiSecret string
	baseURL   string
	client    *hindsight.APIClient
}

type hindsightClientOptions struct {
	apiSecret string
	baseURL   string
	timeout   time.Duration
}

type hindsightBankConfig struct {
	MemoryDefense hindsightMemoryDefenseConfig `json:"memory_defense"`
}

type hindsightMemoryDefenseConfig struct {
	Enabled bool                         `json:"enabled"`
	Rules   []hindsightMemoryDefenseRule `json:"rules"`
}

type hindsightMemoryDefenseRule struct {
	On     string `json:"on"`
	Action string `json:"action"`
}

type hindsightRetainRequest struct {
	Async        *bool                 `json:"async,omitempty"`
	DocumentTags []string              `json:"document_tags,omitempty"`
	Items        []hindsightMemoryItem `json:"items"`
}

type hindsightRetainResponse struct {
	Async        bool     `json:"async"`
	BankID       string   `json:"bank_id"`
	ItemsCount   int      `json:"items_count"`
	OperationID  string   `json:"operation_id,omitempty"`
	OperationIDs []string `json:"operation_ids,omitempty"`
	Success      bool     `json:"success"`
}

type hindsightMemoryItem struct {
	Content    string            `json:"content"`
	Context    string            `json:"context,omitempty"`
	DocumentID string            `json:"document_id,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	Tags       []string          `json:"tags,omitempty"`
	Timestamp  string            `json:"timestamp,omitempty"`
	UpdateMode string            `json:"update_mode,omitempty"`
}

type hindsightRecallRequest struct {
	Budget         string   `json:"budget,omitempty"`
	MaxTokens      int      `json:"max_tokens,omitempty"`
	Query          string   `json:"query"`
	QueryTimestamp string   `json:"query_timestamp,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	TagsMatch      string   `json:"tags_match,omitempty"`
	Trace          bool     `json:"trace,omitempty"`
	Types          []string `json:"types,omitempty"`
}

type hindsightRecallResponse struct {
	Results []hindsightRecallResult `json:"results"`
}

type hindsightRecallResult struct {
	DocumentID    string            `json:"document_id,omitempty"`
	ID            string            `json:"id"`
	MentionedAt   string            `json:"mentioned_at,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	OccurredEnd   string            `json:"occurred_end,omitempty"`
	OccurredStart string            `json:"occurred_start,omitempty"`
	Tags          []string          `json:"tags,omitempty"`
	Text          string            `json:"text"`
	Type          string            `json:"type,omitempty"`
}

type hindsightConversationTurn struct {
	Content string `json:"content"`
	Role    string `json:"role"`
}

type hindsightReflectRequest struct {
	Budget       string   `json:"budget,omitempty"`
	Context      string   `json:"context,omitempty"`
	FactTypes    []string `json:"fact_types,omitempty"`
	IncludeFacts bool     `json:"include_facts"`
	MaxTokens    int      `json:"max_tokens,omitempty"`
	Query        string   `json:"query"`
	Tags         []string `json:"tags,omitempty"`
	TagsMatch    string   `json:"tags_match,omitempty"`
}

type hindsightReflectResponse struct {
	BasedOnMemories  []hindsightReflectFact   `json:"based_on_memories,omitempty"`
	StructuredOutput map[string]any           `json:"structured_output,omitempty"`
	Text             string                   `json:"text"`
	Usage            memoryruntime.TokenUsage `json:"usage,omitempty"`
}

type hindsightReflectFact struct {
	Context       string `json:"context,omitempty"`
	ID            string `json:"id,omitempty"`
	OccurredEnd   string `json:"occurred_end,omitempty"`
	OccurredStart string `json:"occurred_start,omitempty"`
	Text          string `json:"text"`
	Type          string `json:"type,omitempty"`
}

type hindsightOperationStatusResponse struct {
	CompletedAt    string         `json:"completed_at,omitempty"`
	CreatedAt      string         `json:"created_at,omitempty"`
	ErrorMessage   string         `json:"error_message,omitempty"`
	OperationID    string         `json:"operation_id"`
	OperationType  string         `json:"operation_type,omitempty"`
	ResultMetadata map[string]any `json:"result_metadata,omitempty"`
	RetryCount     int            `json:"retry_count,omitempty"`
	Status         string         `json:"status"`
	UpdatedAt      string         `json:"updated_at,omitempty"`
}

type hindsightOperationListRequest struct {
	ExcludeParents bool   `json:"exclude_parents,omitempty"`
	Limit          int    `json:"limit,omitempty"`
	Offset         int    `json:"offset,omitempty"`
	OperationType  string `json:"operation_type,omitempty"`
	Status         string `json:"status,omitempty"`
}

type hindsightOperationListResponse struct {
	Limit      int                      `json:"limit"`
	Offset     int                      `json:"offset"`
	Operations []hindsightOperationItem `json:"operations"`
	Total      int                      `json:"total"`
}

type hindsightOperationItem struct {
	CreatedAt     string `json:"created_at,omitempty"`
	ErrorMessage  string `json:"error_message,omitempty"`
	ItemsCount    int    `json:"items_count,omitempty"`
	OperationID   string `json:"operation_id"`
	OperationType string `json:"operation_type,omitempty"`
	RetryCount    int    `json:"retry_count,omitempty"`
	Status        string `json:"status"`
	UpdatedAt     string `json:"updated_at,omitempty"`
}

type hindsightOperationActionResponse struct {
	Message     string `json:"message,omitempty"`
	OperationID string `json:"operation_id"`
	Success     bool   `json:"success"`
}

func newHindsightHTTPClient(options hindsightClientOptions) hindsightHTTPClient {
	timeout := options.timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	baseURL := strings.TrimRight(strings.TrimSpace(options.baseURL), "/")
	apiSecret := strings.TrimSpace(options.apiSecret)
	return hindsightHTTPClient{
		apiSecret: apiSecret,
		baseURL:   baseURL,
		client:    hindsight.NewAPIClientWithTimeout(baseURL, apiSecret, timeout),
	}
}

var _ hindsightClient = hindsightHTTPClient{}
