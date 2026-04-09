export function RouteStatusCard(props: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <main className="route-status-layout">
      <section className="route-status-card">
        <p className="route-status-eyebrow">Campus Agent</p>
        <h1>{props.title}</h1>
        <p>{props.message}</p>
        {props.actionLabel && props.onAction ? (
          <button className="route-status-action" onClick={props.onAction} type="button">
            {props.actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  );
}
