package campus.k8s.config_secrets

pre_deploy_job if {
	input.kind == "Job"
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/sync-wave", "") == "-1"
}

violation contains msg if {
	pre_deploy_job
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/hook", "") != ""
	msg := sprintf("pre-deploy Job %s must remain an Argo CD tracked resource", [input.metadata.name])
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
