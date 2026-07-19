package httpapi

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	hindsight "github.com/vectorize-io/hindsight/hindsight-clients/go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

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
		Timeout: timeout,
		Transport: hindsightPropagationTransport{
			base: http.DefaultTransport,
		},
	}
	return hindsightHTTPClient{
		apiSecret: apiSecret,
		baseURL:   baseURL,
		client:    hindsight.NewAPIClient(clientConfig),
	}
}

type hindsightPropagationTransport struct {
	base http.RoundTripper
}

type hindsightBankContextKey struct{}

func withHindsightBankContext(ctx context.Context, bankID string) context.Context {
	return context.WithValue(ctx, hindsightBankContextKey{}, strings.TrimSpace(bankID))
}

func hindsightBankIDFromContext(ctx context.Context) string {
	bankID, _ := ctx.Value(hindsightBankContextKey{}).(string)
	return strings.TrimSpace(bankID)
}

func (t hindsightPropagationTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	attributes := []attribute.KeyValue{
		attribute.String("memory.provider", "hindsight"),
		attribute.String("http.request.method", request.Method),
	}
	if bankID := hindsightBankIDFromContext(request.Context()); bankID != "" {
		attributes = append(attributes, attribute.String("langfuse.user.id", bankID))
	}
	ctx, span := otel.Tracer("campus-execution-control/hindsight").Start(
		request.Context(),
		"memory.call",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attributes...),
	)
	cloned := request.Clone(ctx)
	cloned.Header = request.Header.Clone()
	otel.GetTextMapPropagator().Inject(
		cloned.Context(),
		propagation.HeaderCarrier(cloned.Header),
	)
	base := t.base
	if base == nil {
		base = http.DefaultTransport
	}
	response, err := base.RoundTrip(cloned)
	if err != nil {
		span.SetStatus(codes.Error, "memory provider transport failed")
		span.End()
		return nil, err
	}
	if response.StatusCode >= http.StatusBadRequest {
		span.SetStatus(codes.Error, "memory provider request failed")
	}
	if response.Body == nil {
		span.End()
		return response, nil
	}
	response.Body = &spanEndingReadCloser{
		ReadCloser: response.Body,
		end:        func() { span.End() },
	}
	return response, nil
}

type spanEndingReadCloser struct {
	io.ReadCloser
	end  func()
	once sync.Once
}

func (b *spanEndingReadCloser) Read(buffer []byte) (int, error) {
	read, err := b.ReadCloser.Read(buffer)
	if err == io.EOF {
		b.once.Do(b.end)
	}
	return read, err
}

func (b *spanEndingReadCloser) Close() error {
	err := b.ReadCloser.Close()
	b.once.Do(b.end)
	return err
}

var _ hindsightClient = hindsightHTTPClient{}
