package config

func defaultWorkerProfiles() map[string]WorkerProfile {
	return map[string]WorkerProfile{
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
}
