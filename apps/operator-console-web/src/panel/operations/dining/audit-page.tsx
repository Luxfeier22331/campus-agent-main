import { useQuery } from "@tanstack/react-query";

import { listDiningAuditEvents } from "./model/api";

export function AuditPage() {
	const auditQuery = useQuery({
		queryFn: listDiningAuditEvents,
		queryKey: ["dining-ops", "audit-events"],
	});

	return (
		<section className="space-y-6">
			<div className="ops-panel p-6">
				<p className="ops-eyebrow">Audit</p>
				<h2 className="ops-title">审计记录</h2>
				<p className="mt-2 text-sm text-zinc-600">记录食堂运营对象的编辑与发布动作。</p>
			</div>
			<div className="ops-panel overflow-hidden">
				<table className="ops-table">
					<thead>
						<tr>
							<th>Action</th>
							<th>Object</th>
							<th>Operator</th>
							<th>Time</th>
						</tr>
					</thead>
					<tbody>
						{auditQuery.data?.events.map((event) => (
							<tr key={event.auditEventId}>
								<td>{event.action}</td>
								<td>
									<span className="block text-zinc-950">{event.objectKind}</span>
									<span className="text-xs text-zinc-500">{event.objectId}</span>
								</td>
								<td>{event.actorDisplayName}</td>
								<td>{event.occurredAt}</td>
							</tr>
						))}
					</tbody>
				</table>
				{auditQuery.data?.events.length === 0 ? (
					<p className="p-6 text-sm text-zinc-500">暂无审计记录。</p>
				) : null}
			</div>
		</section>
	);
}
