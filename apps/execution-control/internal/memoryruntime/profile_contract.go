package memoryruntime

import (
	"fmt"
	"strings"
)

// ProfileQuery identifies one owner's synthesized profile read. The profile is
// derived from the owner's stored memories, so it is scoped and fenced exactly
// like a management memory read.
type ProfileQuery struct {
	TenantID        string `json:"tenant_id"`
	OwnerUserID     string `json:"owner_user_id"`
	OwnerGeneration int64  `json:"owner_generation"`
}

// ProfileRecord is the projection of the owner's synthesized profile.
// Generating is true when the synthesis has been started but has not produced
// content yet, including the lazy-create window after the first read.
type ProfileRecord struct {
	Content         string `json:"content"`
	Generating      bool   `json:"generating"`
	IsStale         bool   `json:"is_stale"`
	LastRefreshedAt string `json:"last_refreshed_at"`
}

func ValidateProfileQuery(query ProfileQuery) error {
	if strings.TrimSpace(query.TenantID) == "" || strings.TrimSpace(query.OwnerUserID) == "" || query.OwnerGeneration < 1 {
		return fmt.Errorf("profile query tenant, owner, and generation are required")
	}
	return nil
}
