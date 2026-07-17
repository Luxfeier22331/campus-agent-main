package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

const (
	langfuseMaintenancePageSize     = 100
	langfuseMaintenanceMaxPages     = 1000
	langfuseMaintenanceMaxBodyBytes = 1 << 20
)

type langfuseTraceMaintenance interface {
	PurgeUserTraces(context.Context, string) (int, error)
	CountUserTraces(context.Context, string) (int, error)
	PurgeUserTracesBefore(context.Context, string, time.Time) (int, error)
	CountUserTracesBefore(context.Context, string, time.Time) (int, error)
	PurgeTracesBefore(context.Context, time.Time) (int, error)
	CountTracesBefore(context.Context, time.Time) (int, error)
}

type langfuseTraceMaintenanceClient struct {
	baseURL    *url.URL
	httpClient *http.Client
	publicKey  string
	secretKey  string
}

type langfuseTrace struct {
	ID string `json:"id"`
}

type langfuseTracePageMeta struct {
	Limit      int
	Page       int
	TotalItems int
	TotalPages int
}

type langfuseTracePage struct {
	Data []langfuseTrace
	Meta langfuseTracePageMeta
}

type langfuseTracePageWire struct {
	Data *[]langfuseTrace `json:"data"`
	Meta *struct {
		Limit      *int `json:"limit"`
		Page       *int `json:"page"`
		TotalItems *int `json:"totalItems"`
		TotalPages *int `json:"totalPages"`
	} `json:"meta"`
}

func newLangfuseTraceMaintenance(
	cfg config.Config,
) (langfuseTraceMaintenance, langfuseTraceMaintenance, error) {
	baseURL := strings.TrimSpace(cfg.LangfuseMaintenanceBaseURL)
	runtimePublicKey := strings.TrimSpace(cfg.LangfuseRuntimeMaintenancePublicKey)
	runtimeSecretKey := strings.TrimSpace(cfg.LangfuseRuntimeMaintenanceSecretKey)
	hindsightPublicKey := strings.TrimSpace(cfg.LangfuseHindsightMaintenancePublicKey)
	hindsightSecretKey := strings.TrimSpace(cfg.LangfuseHindsightMaintenanceSecretKey)
	if baseURL == "" && runtimePublicKey == "" && runtimeSecretKey == "" &&
		hindsightPublicKey == "" && hindsightSecretKey == "" {
		return nil, nil, nil
	}
	if baseURL == "" || runtimePublicKey == "" || runtimeSecretKey == "" ||
		hindsightPublicKey == "" || hindsightSecretKey == "" {
		return nil, nil, errors.New("Langfuse trace maintenance configuration is incomplete")
	}
	runtimeClient, err := newLangfuseTraceMaintenanceClient(baseURL, runtimePublicKey, runtimeSecretKey)
	if err != nil {
		return nil, nil, err
	}
	hindsightClient, err := newLangfuseTraceMaintenanceClient(baseURL, hindsightPublicKey, hindsightSecretKey)
	if err != nil {
		return nil, nil, err
	}
	return runtimeClient, hindsightClient, nil
}

func newLangfuseTraceMaintenanceClient(
	baseURL string,
	publicKey string,
	secretKey string,
) (*langfuseTraceMaintenanceClient, error) {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.Opaque != "" || parsed.Path != "" || parsed.RawPath != "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("LANGFUSE_MAINTENANCE_BASE_URL must be an http(s) origin without credentials, path, query, or fragment")
	}
	return &langfuseTraceMaintenanceClient{
		baseURL: parsed,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		publicKey: strings.TrimSpace(publicKey),
		secretKey: strings.TrimSpace(secretKey),
	}, nil
}

func (c *langfuseTraceMaintenanceClient) PurgeUserTraces(ctx context.Context, userID string) (int, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return 0, errors.New("Langfuse trace user id is required")
	}
	query := url.Values{"userId": []string{userID}}
	return c.purgeTraces(ctx, query)
}

func (c *langfuseTraceMaintenanceClient) CountUserTraces(ctx context.Context, userID string) (int, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return 0, errors.New("Langfuse trace user id is required")
	}
	return c.countTraces(ctx, url.Values{"userId": []string{userID}})
}

func (c *langfuseTraceMaintenanceClient) PurgeUserTracesBefore(
	ctx context.Context,
	userID string,
	cutoff time.Time,
) (int, error) {
	query, err := langfuseUserTraceCutoffQuery(userID, cutoff)
	if err != nil {
		return 0, err
	}
	return c.purgeTraces(ctx, query)
}

func (c *langfuseTraceMaintenanceClient) CountUserTracesBefore(
	ctx context.Context,
	userID string,
	cutoff time.Time,
) (int, error) {
	query, err := langfuseUserTraceCutoffQuery(userID, cutoff)
	if err != nil {
		return 0, err
	}
	return c.countTraces(ctx, query)
}

func (c *langfuseTraceMaintenanceClient) PurgeTracesBefore(
	ctx context.Context,
	cutoff time.Time,
) (int, error) {
	query, err := langfuseTraceCutoffQuery(cutoff)
	if err != nil {
		return 0, err
	}
	return c.purgeTraces(ctx, query)
}

func (c *langfuseTraceMaintenanceClient) CountTracesBefore(
	ctx context.Context,
	cutoff time.Time,
) (int, error) {
	query, err := langfuseTraceCutoffQuery(cutoff)
	if err != nil {
		return 0, err
	}
	return c.countTraces(ctx, query)
}

func langfuseTraceCutoffQuery(cutoff time.Time) (url.Values, error) {
	if cutoff.IsZero() {
		return nil, errors.New("Langfuse trace retention cutoff is required")
	}
	return url.Values{"toTimestamp": []string{cutoff.UTC().Format(time.RFC3339Nano)}}, nil
}

func langfuseUserTraceCutoffQuery(userID string, cutoff time.Time) (url.Values, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, errors.New("Langfuse trace user id is required")
	}
	query, err := langfuseTraceCutoffQuery(cutoff)
	if err != nil {
		return nil, err
	}
	query.Set("userId", userID)
	return query, nil
}

func (c *langfuseTraceMaintenanceClient) purgeTraces(
	ctx context.Context,
	query url.Values,
) (int, error) {
	traceIDs, err := c.collectTraceIDs(ctx, query)
	if err != nil {
		return 0, err
	}
	deleted := 0
	for start := 0; start < len(traceIDs); start += langfuseMaintenancePageSize {
		end := min(start+langfuseMaintenancePageSize, len(traceIDs))
		if err := c.deleteTraces(ctx, traceIDs[start:end]); err != nil {
			return deleted, err
		}
		deleted += end - start
	}
	return deleted, nil
}

func (c *langfuseTraceMaintenanceClient) collectTraceIDs(
	ctx context.Context,
	query url.Values,
) ([]string, error) {
	traceIDs := make([]string, 0, langfuseMaintenancePageSize)
	seen := make(map[string]struct{}, langfuseMaintenancePageSize)
	for pageNumber := 1; pageNumber <= langfuseMaintenanceMaxPages; pageNumber++ {
		page, err := c.listTraces(ctx, query, pageNumber, langfuseMaintenancePageSize)
		if err != nil {
			return nil, err
		}
		if page.Meta.TotalItems < 0 || page.Meta.TotalPages < 0 {
			return nil, errors.New("Langfuse trace list returned invalid pagination metadata")
		}
		if page.Meta.TotalItems > langfuseMaintenancePageSize*langfuseMaintenanceMaxPages ||
			page.Meta.TotalPages > langfuseMaintenanceMaxPages {
			return nil, errors.New("Langfuse trace list exceeded the bounded pagination limit")
		}
		for _, trace := range page.Data {
			traceID := strings.TrimSpace(trace.ID)
			if traceID == "" {
				return nil, errors.New("Langfuse trace list returned an empty trace id")
			}
			if _, ok := seen[traceID]; ok {
				continue
			}
			seen[traceID] = struct{}{}
			traceIDs = append(traceIDs, traceID)
		}
		if len(page.Data) < langfuseMaintenancePageSize ||
			(page.Meta.TotalPages > 0 && pageNumber >= page.Meta.TotalPages) {
			return traceIDs, nil
		}
	}
	return nil, errors.New("Langfuse trace list exceeded the bounded pagination limit")
}

func (c *langfuseTraceMaintenanceClient) countTraces(
	ctx context.Context,
	query url.Values,
) (int, error) {
	page, err := c.listTraces(ctx, query, 1, 1)
	if err != nil {
		return 0, err
	}
	if page.Meta.TotalItems < 0 {
		return 0, errors.New("Langfuse trace list returned invalid pagination metadata")
	}
	if page.Meta.TotalItems > 0 {
		return page.Meta.TotalItems, nil
	}
	return len(page.Data), nil
}

func (c *langfuseTraceMaintenanceClient) listTraces(
	ctx context.Context,
	filter url.Values,
	pageNumber int,
	limit int,
) (langfuseTracePage, error) {
	query := make(url.Values, len(filter)+4)
	for key, values := range filter {
		query[key] = append([]string(nil), values...)
	}
	query.Set("fields", "core")
	query.Set("limit", strconv.Itoa(limit))
	query.Set("orderBy", "timestamp.asc")
	query.Set("page", strconv.Itoa(pageNumber))
	payload, err := c.request(ctx, http.MethodGet, "/api/public/traces", query, nil, http.StatusOK)
	if err != nil {
		return langfuseTracePage{}, err
	}
	var wire langfuseTracePageWire
	if err := json.Unmarshal(payload, &wire); err != nil {
		return langfuseTracePage{}, errors.New("Langfuse trace list returned invalid JSON")
	}
	if wire.Data == nil || wire.Meta == nil || wire.Meta.Limit == nil || wire.Meta.Page == nil ||
		wire.Meta.TotalItems == nil || wire.Meta.TotalPages == nil {
		return langfuseTracePage{}, errors.New("Langfuse trace list returned an incomplete response contract")
	}
	page := langfuseTracePage{
		Data: *wire.Data,
		Meta: langfuseTracePageMeta{
			Limit:      *wire.Meta.Limit,
			Page:       *wire.Meta.Page,
			TotalItems: *wire.Meta.TotalItems,
			TotalPages: *wire.Meta.TotalPages,
		},
	}
	if err := validateLangfuseTracePage(page, pageNumber, limit); err != nil {
		return langfuseTracePage{}, err
	}
	return page, nil
}

func validateLangfuseTracePage(page langfuseTracePage, requestedPage int, requestedLimit int) error {
	if requestedPage < 1 || requestedLimit < 1 ||
		page.Meta.Page != requestedPage || page.Meta.Limit != requestedLimit ||
		page.Meta.TotalItems < 0 || page.Meta.TotalPages < 0 ||
		len(page.Data) > requestedLimit || len(page.Data) > page.Meta.TotalItems {
		return errors.New("Langfuse trace list returned invalid pagination metadata")
	}
	expectedPages := page.Meta.TotalItems / requestedLimit
	if page.Meta.TotalItems%requestedLimit != 0 {
		expectedPages++
	}
	if page.Meta.TotalPages != expectedPages ||
		(page.Meta.TotalPages > 0 && requestedPage > page.Meta.TotalPages) {
		return errors.New("Langfuse trace list returned inconsistent pagination metadata")
	}
	return nil
}

func (c *langfuseTraceMaintenanceClient) deleteTraces(ctx context.Context, traceIDs []string) error {
	if len(traceIDs) == 0 {
		return nil
	}
	if len(traceIDs) > langfuseMaintenancePageSize {
		return errors.New("Langfuse trace delete batch exceeded the batch limit")
	}
	payload, err := json.Marshal(struct {
		TraceIDs []string `json:"traceIds"`
	}{TraceIDs: traceIDs})
	if err != nil {
		return errors.New("encode Langfuse trace delete request failed")
	}
	_, err = c.request(
		ctx,
		http.MethodDelete,
		"/api/public/traces",
		nil,
		payload,
		http.StatusOK,
		http.StatusNoContent,
		http.StatusNotFound,
	)
	return err
}

func (c *langfuseTraceMaintenanceClient) request(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body []byte,
	expectedStatuses ...int,
) ([]byte, error) {
	if c == nil || c.baseURL == nil || c.httpClient == nil {
		return nil, errors.New("Langfuse trace maintenance client is not configured")
	}
	if len(body) > langfuseMaintenanceMaxBodyBytes {
		return nil, errors.New("Langfuse trace maintenance request exceeded the body limit")
	}
	requestURL := *c.baseURL
	requestURL.Path = strings.TrimRight(requestURL.Path, "/") + path
	requestURL.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, method, requestURL.String(), bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("create Langfuse trace maintenance request failed")
	}
	request.Header.Set("accept", "application/json")
	if len(body) > 0 {
		request.Header.Set("content-type", "application/json")
	}
	request.SetBasicAuth(c.publicKey, c.secretKey)
	response, err := c.httpClient.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("Langfuse trace maintenance transport failed")
	}
	defer func() { _ = response.Body.Close() }()
	accepted := false
	for _, status := range expectedStatuses {
		if response.StatusCode == status {
			accepted = true
			break
		}
	}
	if !accepted {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, langfuseMaintenanceMaxBodyBytes))
		return nil, fmt.Errorf("Langfuse trace maintenance returned status %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, langfuseMaintenanceMaxBodyBytes+1))
	if err != nil {
		return nil, errors.New("read Langfuse trace maintenance response failed")
	}
	if len(payload) > langfuseMaintenanceMaxBodyBytes {
		return nil, errors.New("Langfuse trace maintenance response exceeded the body limit")
	}
	return payload, nil
}

var _ langfuseTraceMaintenance = (*langfuseTraceMaintenanceClient)(nil)
