package config

import (
	"fmt"
	"strings"
)

func readWorkerProfilesStrict() (map[string]WorkerProfile, error) {
	profiles := map[string]WorkerProfile{
		"workflow": {
			WorkflowTaskPollers: 2,
			WorkflowTaskSlots:   16,
		},
		"activity-core": {
			ActivitySlots:       8,
			ActivityTaskPollers: 2,
		},
		"activity-agent": {
			ActivitySlots:       4,
			ActivityTaskPollers: 2,
		},
	}
	for role, profile := range profiles {
		prefix := "EXECUTION_CONTROL_WORKER_" + envRoleName(role) + "_"
		if profile.ActivityTaskPollers > 0 && profile.ActivitySlots <= 0 {
			return nil, fmt.Errorf("%sACTIVITY_SLOTS must be positive when activity pollers are configured", prefix)
		}
		if profile.WorkflowTaskPollers > 0 && profile.WorkflowTaskSlots <= 0 {
			return nil, fmt.Errorf("%sWORKFLOW_TASK_SLOTS must be positive when workflow pollers are configured", prefix)
		}
	}
	return profiles, nil
}

func envRoleName(role string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(role), "-", "_"))
}
