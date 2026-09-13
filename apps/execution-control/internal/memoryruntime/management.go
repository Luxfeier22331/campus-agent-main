package memoryruntime

import "errors"

var ErrMemoryNotFound = errors.New("personal memory not found")

type MemoryQuery struct {
	TenantID        string `json:"tenantId"`
	OwnerUserID     string `json:"ownerUserId"`
	OwnerGeneration int64  `json:"ownerGeneration"`
	MemoryID        string `json:"memoryId,omitempty"`
	Query           string `json:"q,omitempty"`
	Kind            string `json:"kind,omitempty"`
	State           string `json:"state,omitempty"`
	Limit           int    `json:"limit"`
	Offset          int    `json:"offset"`
}
type MemoryRecord struct {
	MemoryID       string         `json:"memoryId"`
	Text           string         `json:"text"`
	Kind           string         `json:"kind"`
	State          string         `json:"state"`
	Origin         string         `json:"origin"`
	MentionedAt    *string        `json:"mentionedAt"`
	EditedAt       *string        `json:"editedAt"`
	SourceMemories []MemoryRecord `json:"sourceMemories,omitempty"`
}
type MemoryPage struct {
	Items  []MemoryRecord `json:"items"`
	Total  int            `json:"total"`
	Limit  int            `json:"limit"`
	Offset int            `json:"offset"`
}

var ErrMemoryEditRejected = errors.New("memory edit rejected")
