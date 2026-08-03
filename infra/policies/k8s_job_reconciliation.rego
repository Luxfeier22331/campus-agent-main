package campus.k8s.config_secrets

pre_deploy_job if {
	input.kind == "Job"
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/sync-wave", "") == "-1"
}

internal_portal_check if {
	input.kind == "CronJob"
	input.metadata.name == "ops-web-internal-portal-check"
}

violation contains msg if {
	pre_deploy_job
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/hook", "") != ""
	msg := sprintf("pre-deploy Job %s must remain an Argo CD tracked resource", [input.metadata.name])
}

violation contains msg if {
	internal_portal_check
	object.get(input.spec, "schedule", "") != "*/30 * * * *"
	msg := "ops-web-internal-portal-check must run every 30 minutes"
}

violation contains msg if {
	internal_portal_check
	object.get(input.spec, "concurrencyPolicy", "") != "Forbid"
	msg := "ops-web-internal-portal-check must forbid concurrent runs"
}

violation contains msg if {
	internal_portal_check
	object.get(input.spec, "successfulJobsHistoryLimit", -1) != 3
	msg := "ops-web-internal-portal-check must retain 3 successful Jobs"
}

violation contains msg if {
	internal_portal_check
	object.get(input.spec, "failedJobsHistoryLimit", -1) != 1
	msg := "ops-web-internal-portal-check must retain 1 failed Job"
}

violation contains msg if {
	internal_portal_check
	job_template := object.get(input.spec, "jobTemplate", {})
	job_spec := object.get(job_template, "spec", {})
	object.get(job_spec, "backoffLimit", -1) != 0
	msg := "ops-web-internal-portal-check must not retry within a scheduled Job"
}

violation contains msg if {
	pre_deploy_job
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/hook-delete-policy", "") != ""
	msg := sprintf("pre-deploy Job %s must not use a hook deletion policy", [input.metadata.name])
}

violation contains msg if {
	pre_deploy_job
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/sync-options", "") != "Force=true,Replace=true"
	msg := sprintf("pre-deploy Job %s must use Force=true,Replace=true", [input.metadata.name])
}
