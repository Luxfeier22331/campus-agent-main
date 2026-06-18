export interface RawOperatorContext {
	display_name: string | null;
	email: string | null;
	groups: string[];
	operator_id: string;
	principal_class: "human";
	subject: string;
}

export interface PanelOverviewRecord {
	id: "overview";
	appName: string;
	operatorContext: OperatorContext | null;
	protectedHostname: string;
	protectionEnvelope: string;
	runtime: string;
	runtimeApiBaseUrl: string;
	status: string;
	surface: string;
}

export interface RawPanelOverviewResponse {
	app_name: string;
	operator_context?: RawOperatorContext;
	protected_hostname: string;
	protection_envelope: string;
	runtime: string;
	runtime_api_base_url: string;
	status: string;
	surface: string;
}

export interface OperatorContext {
	displayName: string | null;
	email: string | null;
	groups: string[];
	operatorId: string;
	principalClass: "human";
	subject: string;
}

export function normalizeOperatorContext(
	input: RawOperatorContext | undefined,
): OperatorContext | null {
	if (!input) {
		return null;
	}

	return {
		displayName: input.display_name,
		email: input.email,
		groups: input.groups,
		operatorId: input.operator_id,
		principalClass: input.principal_class,
		subject: input.subject,
	};
}

export function normalizeOverviewRecord(input: RawPanelOverviewResponse): PanelOverviewRecord {
	return {
		appName: input.app_name,
		id: "overview",
		operatorContext: normalizeOperatorContext(input.operator_context),
		protectedHostname: input.protected_hostname,
		protectionEnvelope: input.protection_envelope,
		runtime: input.runtime,
		runtimeApiBaseUrl: input.runtime_api_base_url,
		status: input.status,
		surface: input.surface,
	};
}
