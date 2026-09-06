package modelconfig

import "time"

type ConfigName string

const (
	ConfigPrimaryAgent         ConfigName = "primary_agent"
	ConfigCampusDocsEmbedding  ConfigName = "campus_docs_embedding"
	ConfigCampusDocsReranker   ConfigName = "campus_docs_reranker"
	ConfigNoticeClassification ConfigName = "notice_classification"
)

var AllConfigNames = []ConfigName{ConfigPrimaryAgent, ConfigCampusDocsEmbedding, ConfigCampusDocsReranker, ConfigNoticeClassification}

type Target struct {
	Name        ConfigName `json:"name"`
	Provider    string     `json:"provider"`
	APIProtocol string     `json:"api_protocol"`
	BaseURL     string     `json:"base_url"`
	Model       string     `json:"model"`
}

type Capabilities struct {
	HostedWebSearch bool `json:"hosted_web_search"`
}

type Descriptor struct {
	SchemaVersion string `json:"schema_version"`
	Target
	Capabilities Capabilities `json:"capabilities"`
	TargetSHA256 string       `json:"target_sha256"`
}

type RuntimeConfig struct {
	SchemaVersion string `json:"schema_version"`
	Target
	Capabilities Capabilities `json:"capabilities"`
	APIKey       string       `json:"api_key"`
	TargetSHA256 string       `json:"target_sha256"`
}

type ConfigInput struct {
	Name        ConfigName `json:"name"`
	APIKey      *string    `json:"api_key"`
	Provider    string     `json:"provider"`
	APIProtocol string     `json:"api_protocol"`
	BaseURL     string     `json:"base_url"`
	Model       string     `json:"model"`
}

type Validation struct {
	Status             string `json:"status"`
	ErrorCode          string `json:"error_code,omitempty"`
	Message            string `json:"message"`
	ObservedDimensions int    `json:"observed_dimensions,omitempty"`
}

type ConfigView struct {
	Descriptor
	CredentialConfigured bool        `json:"credential_configured"`
	Validation           *Validation `json:"validation"`
	ValidatedAt          *time.Time  `json:"validated_at"`
	ValidatedBy          *string     `json:"validated_by"`
	UpdatedAt            time.Time   `json:"updated_at"`
	UpdatedBy            string      `json:"updated_by"`
}

type Status struct {
	SchemaVersion string                     `json:"schema_version"`
	SampledAt     time.Time                  `json:"sampled_at"`
	Configs       map[ConfigName]*ConfigView `json:"configs"`
}
