import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import { useState } from "react";

import { listDiningReleases, publishDiningRelease } from "../../features/dining/api";

export function ReleasesPage() {
	const queryClient = useQueryClient();
	const [notes, setNotes] = useState("");
	const releasesQuery = useQuery({
		queryFn: listDiningReleases,
		queryKey: ["dining-ops", "releases"],
	});
	const publishMutation = useMutation({
		mutationFn: () => publishDiningRelease({ notes }),
		onSuccess: () => {
			setNotes("");
			void queryClient.invalidateQueries({ queryKey: ["dining-ops", "releases"] });
		},
	});

	return (
		<section className="space-y-6">
			<div className="ops-panel p-6">
				<p className="ops-eyebrow">Release</p>
				<h2 className="ops-title">食堂发布</h2>
				<form
					className="mt-4 flex flex-col gap-3 md:flex-row"
					onSubmit={(event) => {
						event.preventDefault();
						publishMutation.mutate();
					}}
				>
					<label className="ops-field flex-1">
						<span>发布说明</span>
						<input value={notes} onChange={(event) => setNotes(event.target.value)} />
					</label>
					<button
						className="ops-primary-button self-end"
						disabled={!notes || publishMutation.isPending}
						type="submit"
					>
						<Rocket aria-hidden="true" className="size-4" />
						发布
					</button>
				</form>
			</div>
			<div className="ops-panel overflow-hidden">
				<table className="ops-table">
					<thead>
						<tr>
							<th>Release</th>
							<th>Status</th>
							<th>Notes</th>
							<th>Published</th>
						</tr>
					</thead>
					<tbody>
						{releasesQuery.data?.releases.map((release) => (
							<tr key={release.releaseId}>
								<td>{release.releaseId}</td>
								<td>{release.status}</td>
								<td>{release.notes}</td>
								<td>{release.publishedAt ?? "-"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
