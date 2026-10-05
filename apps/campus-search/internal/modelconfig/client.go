package modelconfigclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxDescriptorResponseBytes = 1 << 20

var lowercaseSHA256 = regexp.MustCompile(`^[0-9a-f]{64}$`)

var ErrNotConfigured = errors.New("model config client is not configured")

type RuntimeConfig struct {
	SchemaVersion string `json:"schema_version"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	APIProtocol   string `json:"api_protocol"`
	BaseURL       string `json:"base_url"`
	Model         string `json:"model"`
	APIKey        string `json:"api_key"`
	TargetSHA256  string `json:"target_sha256"`
	Capabilities  struct {
		HostedWebSearch bool `json:"hosted_web_search"`
	} `json:"capabilities"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, ErrNotConfigured
	}
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout:       5 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

func (c *Client) ResolveRuntimeConfig(ctx context.Context, name string) (RuntimeConfig, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return RuntimeConfig{}, errors.New("model config name is required")
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		c.baseURL+"/internal/model-configs/"+url.PathEscape(name),
		nil,
	)
	if err != nil {
		return RuntimeConfig{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return RuntimeConfig{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return RuntimeConfig{}, fmt.Errorf("model config %s returned HTTP %d", name, response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxDescriptorResponseBytes+1))
	if err != nil {
		return RuntimeConfig{}, err
	}
	if len(raw) > maxDescriptorResponseBytes {
		return RuntimeConfig{}, errors.New("model runtime config is oversized")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var value RuntimeConfig
	if err := decoder.Decode(&value); err != nil {
		return RuntimeConfig{}, fmt.Errorf("decode model runtime config: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return RuntimeConfig{}, errors.New("model runtime config must contain one JSON value")
	}
	if err := validateRuntimeConfig(value, name); err != nil {
		return RuntimeConfig{}, err
	}
	return value, nil
}

func validateRuntimeConfig(value RuntimeConfig, wantName string) error {
	if value.SchemaVersion != "model_runtime_config.v1" || value.Name != wantName {
		return errors.New("model runtime config identity is invalid")
	}
	if value.Provider == "" || value.APIProtocol == "" || value.BaseURL == "" || value.Model == "" || value.APIKey == "" {
		return errors.New("model runtime config is incomplete")
	}
	if value.Provider != "openai" && value.Provider != "openai-compatible" && value.Provider != "cohere" && value.Provider != "cohere-compatible" {
		return errors.New("model runtime config provider is invalid")
	}
	if value.APIProtocol != "openai.responses" && value.APIProtocol != "openai.chat_completions" && value.APIProtocol != "openai.embeddings" && value.APIProtocol != "cohere.rerank" {
		return errors.New("model runtime config API protocol is invalid")
	}
	if !lowercaseSHA256.MatchString(value.TargetSHA256) {
		return errors.New("model runtime config target hash is invalid")
	}
	return nil
}
