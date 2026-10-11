package operation

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
)

func Sha256Bytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func BoundedToolOutcome(value any) string {
	outcome := strings.TrimSpace(execution.StringValue(value))
	if len(outcome) > 128 {
		return outcome[:128]
	}
	return outcome
}

func WorkflowToolDurationMS(value float64) (int64, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value > float64((1<<63)-1) {
		return 0, fmt.Errorf("agent runtime tool duration_ms is invalid")
	}
	return int64(math.Ceil(value)), nil
}

func WorkflowToolProjectionRef(runID string, toolName string, invocationID string) string {
	return activityprojection.ProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%s", toolName, invocationID))
}
