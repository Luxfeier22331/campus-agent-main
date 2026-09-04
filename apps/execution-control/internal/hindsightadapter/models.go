package hindsightadapter

import (
	"net/http"
	"strings"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
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
	EnableAutoConsolidation bool                         `json:"enable_auto_consolidation"`
	EnableObservations      bool                         `json:"enable_observations"`
	MemoryDefense           hindsightMemoryDefenseConfig `json:"memory_defense"`
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
	Async *bool                 `json:"async,omitempty"`
	Items []hindsightMemoryItem `json:"items"`
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
	Content           string            `json:"content"`
	Context           string            `json:"context,omitempty"`
	DocumentID        string            `json:"document_id,omitempty"`
	Metadata          map[string]string `json:"metadata,omitempty"`
	ObservationScopes [][]string        `json:"observation_scopes,omitempty"`
	Tags              []string          `json:"tags,omitempty"`
	Timestamp         string            `json:"timestamp,omitempty"`
	UpdateMode        string            `json:"update_mode,omitempty"`
}

type hindsightRecallRequest struct {
	Budget             string   `json:"budget,omitempty"`
	MaxTokens          int      `json:"max_tokens,omitempty"`
	PreferObservations bool     `json:"prefer_observations,omitempty"`
	Query              string   `json:"query"`
	QueryTimestamp     string   `json:"query_timestamp,omitempty"`
	Tags               []string `json:"tags,omitempty"`
	TagsMatch          string   `json:"tags_match,omitempty"`
	Trace              bool     `json:"trace,omitempty"`
	Types              []string `json:"types,omitempty"`
}

type hindsightRecallResponse struct {
	Results []hindsightRecallResult `json:"results"`
}

type hindsightRecallResult struct {
	DocumentID      string            `json:"document_id,omitempty"`
	ID              string            `json:"id"`
	MentionedAt     string            `json:"mentioned_at,omitempty"`
	Metadata        map[string]string `json:"metadata,omitempty"`
	OccurredEnd     string            `json:"occurred_end,omitempty"`
	OccurredStart   string            `json:"occurred_start,omitempty"`
	Tags            []string          `json:"tags,omitempty"`
	Score           float64           `json:"score,omitempty"`
	SourceFactCount int               `json:"source_fact_count,omitempty"`
	Text            string            `json:"text"`
	Type            string            `json:"type,omitempty"`
}

type hindsightConversationTurn struct {
	Content string `json:"content"`
	Role    string `json:"role"`
}

func newHindsightHTTPClient(options hindsightClientOptions) hindsightHTTPClient {
	timeout := options.timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	baseURL := strings.TrimRight(strings.TrimSpace(options.baseURL), "/")
	apiSecret := strings.TrimSpace(options.apiSecret)
	clientConfig := hindsight.NewConfiguration()
	clientConfig.UserAgent = hindsight.DefaultUserAgent
	clientConfig.Servers = hindsight.ServerConfigurations{{URL: baseURL}}
	clientConfig.AddDefaultHeader("Authorization", "Bearer "+apiSecret)
	clientConfig.HTTPClient = &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Timeout:       timeout,
		Transport:     http.DefaultTransport,
	}
	return hindsightHTTPClient{
		apiSecret: apiSecret,
		baseURL:   baseURL,
		client:    hindsight.NewAPIClient(clientConfig),
	}
}

var _ hindsightClient = hindsightHTTPClient{}
