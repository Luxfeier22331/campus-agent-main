package campus.k8s.config_secrets

test_deleted_sync_hook_is_rejected if {
	violations := violation with input as {
		"kind": "Job",
		"metadata": {
			"name": "schema-install",
			"annotations": {
				"argocd.argoproj.io/hook": "Sync",
				"argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation,HookSucceeded",
				"argocd.argoproj.io/sync-wave": "-1",
			},
		},
	}
	"pre-deploy Job schema-install must remain an Argo CD tracked resource" in violations
	"pre-deploy Job schema-install must not use a hook deletion policy" in violations
	"pre-deploy Job schema-install must use Force=true,Replace=true" in violations
}

test_tracked_pre_deploy_job_is_allowed if {
	violations := violation with input as {
		"kind": "Job",
		"metadata": {
			"name": "schema-install",
			"annotations": {
				"argocd.argoproj.io/sync-options": "Force=true,Replace=true",
				"argocd.argoproj.io/sync-wave": "-1",
			},
		},
	}
	count(violations) == 0
}

test_post_sync_hook_is_outside_pre_deploy_contract if {
	violations := violation with input as {
		"kind": "Job",
		"metadata": {
			"name": "object-store-bootstrap",
			"annotations": {
				"argocd.argoproj.io/hook": "PostSync",
				"argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation,HookSucceeded",
			},
		},
	}
	count(violations) == 0
}
