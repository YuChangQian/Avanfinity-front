export function CardNetworkBrand({ network }: { network: string }) {
  const normalized = network.replace(/[\s_-]/g, "").toUpperCase();
  if (normalized === "VISA") return <img className="card-network-logo" src="/card-brands/visa-brand-mark-white-2025.svg" alt="Visa" />;
  if (normalized === "MASTERCARD") return <img className="card-network-logo" src="/card-brands/mastercard-symbol.png" alt="Mastercard" />;
  return <span className="card-network-mark">{network}</span>;
}
