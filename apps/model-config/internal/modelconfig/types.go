package modelconfig

import "time"

type ConfigName string

const (
	ConfigPrimaryAgent        ConfigName = "primary_agent"
	ConfigCampusDocsEmbedding ConfigName = "campus_docs_embedding"
	ConfigCampusDocsReranker  ConfigName = "campus_docs_reranker"
	ConfigDocumentOCR         ConfigName = "document_ocr"
	// Each notice classification backend keeps its own credential so switching
	// never discards a key. The decision backend is any System One provider.
	ConfigNoticeClassificationDecision ConfigName = "notice_classification_decision"
	ConfigNoticeClassificationLLM      ConfigName = "notice_classification_llm"
	// ConfigNoticeClassification is a read alias for the selected backend
	// credential; it is never stored as a row.
	ConfigNoticeClassification ConfigName = "notice_classification"
)

// aliasConfigs lists the stored credentials each read alias may select.
var aliasConfigs = map[ConfigName][]ConfigName{
	ConfigNoticeClassification: {ConfigNoticeClassificationDecision, ConfigNoticeClassificationLLM},
}

// IsAlias reports whether name is a read alias rather than a stored config.
func IsAlias(name ConfigName) bool {
	_, ok := aliasConfigs[name]
	return ok
}

// AliasAllows reports whether alias may select the stored config name.
func AliasAllows(alias, name ConfigName) bool {
	for _, candidate := range aliasConfigs[alias] {
		if candidate == name {
			return true
		}
	}
	return false
}

// NoticeClassificationConfig reports whether name stores a notice
// classification backend credential.
func NoticeClassificationConfig(name ConfigName) bool {
	return name == ConfigNoticeClassificationDecision || name == ConfigNoticeClassificationLLM
}

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
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
	SchemaVersion string     `json:"schema_version"`
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

type Selection struct {
	ConfigName ConfigName `json:"config_name"`
	UpdatedAt  time.Time  `json:"updated_at"`
	UpdatedBy  string     `json:"updated_by"`
}

type Status struct {
	SchemaVersion string                     `json:"schema_version"`
	SampledAt     time.Time                  `json:"sampled_at"`
	Configs       map[ConfigName]*ConfigView `json:"configs"`
	// Selections maps each read alias to its selected credential; an alias
	// without an entry is unavailable.
	Selections map[ConfigName]*Selection `json:"selections"`
}
