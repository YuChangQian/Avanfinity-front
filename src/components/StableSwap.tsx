export function StableSwap({ state, labels }: { state: string; labels: Record<string, string> }) {
  return <span className="stable-swap">{Object.entries(labels).map(([key, text]) => <span key={key} className={key === state ? "is-shown" : undefined} aria-hidden={key === state ? undefined : true}>{text}</span>)}</span>;
}
