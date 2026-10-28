import { formatDecimal, shiftDecimal } from "../decimal";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownToLine, Check, Clock3, Copy, ShieldCheck, XCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataSkeleton } from "../components/PageShell";
import { cancelDeposit, createDeposit, getDepositRecords, type DepositNetwork, type DepositOrder, type DepositRecord } from "../api";
import { sessionAtom, sessionIdentity } from "../state";
import { useTranslation } from "react-i18next";
import { useFeatures } from "../features";

function amountInCents(value: string) {
  if (value.length > 10 || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function hasOrderAmounts(order: DepositOrder | DepositRecord): order is DepositOrder {
  return order.requestedAmount !== null && order.expectedAmount !== null && order.creditedEstimate !== null;
}

function tokenAtomicAmount(amount: string, decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  const fraction = match?.[2] ?? "";
  if (!match || fraction.length > decimals) return null;
  return `${match[1]}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
}

function paymentQrValue(order: DepositOrder, network?: { tokenContract: string; tokenDecimals: number }) {
  if (!network) return order.address;
  if (order.network === "BSC") {
    const amount = tokenAtomicAmount(order.expectedAmount, network.tokenDecimals);
    return amount
      ? `ethereum:${network.tokenContract}@56/transfer?address=${order.address}&uint256=${formatDecimal(amount)}`
      : order.address;
  }
  return order.address;
}

export function DepositPage() {
  const session = useAtomValue(sessionAtom);
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { flags } = useFeatures();
  const [amount, setAmount] = useState("");
  const [fees, setFees] = useState<Partial<Record<DepositNetwork, string>>>({});
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"amount" | "address" | "total" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [networkChoice, setNetworkChoice] = useState<DepositNetwork | null>(null);
  const records = useQuery({
    queryKey: ["deposits", sessionIdentity(session)],
    queryFn: () => getDepositRecords(session!.token),
    enabled: Boolean(session),
    refetchInterval: (query) => query.state.data?.data.some((item) => item.status === "pending") ? 5_000 : false,
  });
  const mutation = useMutation({
    mutationFn: ({ network, requestedAmount }: { network: DepositNetwork; requestedAmount: string }) => createDeposit(session!.token, "USDT", network, requestedAmount),
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["deposits"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("depositCreateFailed")),
  });
  const cancelMutation = useMutation({
    mutationFn: (gatewayRef: string) => cancelDeposit(session!.token, gatewayRef),
    onSuccess: async () => {
      setError("");
      setCopied(null);
      setAmount("");
      setTouched(false);
      await queryClient.invalidateQueries({ queryKey: ["deposits"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : t("cancelDepositFailed")),
  });

  const list = records.data?.data ?? [];
  const networks = records.data?.networks ?? [];
  const selectedNetwork = networkChoice && networks.some((item) => item.network === networkChoice)
    ? networkChoice
    : networks.find((item) => item.enabled && item.ready)?.network ?? networks[0]?.network ?? null;
  const selectedNetworkStatus = networks.find((item) => item.network === selectedNetwork);
  const selectedNetworkAvailable = Boolean(selectedNetworkStatus?.enabled && selectedNetworkStatus.ready);
  const selectedList = selectedNetwork ? list.filter((item) => item.network === selectedNetwork) : [];
  const created = mutation.data?.data.network === selectedNetwork ? mutation.data.data : undefined;
  const createdRecord = created ? list.find((item) => item.gatewayRef === created.gatewayRef) : undefined;
  const currentCandidate = created
    ? (createdRecord ?? created)
    : selectedList.find((item) => item.status === "pending" && hasOrderAmounts(item));
  const currentOrder = currentCandidate && hasOrderAmounts(currentCandidate) ? currentCandidate : undefined;
  const currentNetworkStatus = networks.find((item) => item.network === currentOrder?.network);
  const currentPaymentQrValue = currentOrder ? paymentQrValue(currentOrder, currentNetworkStatus) : "";
  const currentGatewayRef = currentOrder?.gatewayRef;
  const serverStatus = currentOrder && "status" in currentOrder ? currentOrder.status : "pending";
  const expiryMs = currentOrder ? Date.parse(currentOrder.expiredAt) : 0;
  const serverNowMs = Date.parse(records.data?.serverTime ?? "");
  const clockOffsetMs = Number.isFinite(serverNowMs) ? serverNowMs - records.dataUpdatedAt : 0;
  const secondsLeft = Number.isFinite(expiryMs) ? Math.max(0, Math.ceil((expiryMs - now - clockOffsetMs) / 1_000)) : 0;
  const status = serverStatus === "pending" && secondsLeft === 0 ? "expired" : serverStatus;
  const cents = amountInCents(amount.trim());
  const amountValid = cents !== null && cents >= 1_000n && cents <= 100_000_000n;

  const fee = (selectedNetwork && fees[selectedNetwork]) ?? (selectedNetwork === "BSC" ? "0.01" : "0");
  const feeText = fee.trim() || "0";
  const feeUnits = feeText.length <= 14 ? tokenAtomicAmount(feeText, 6) : null;
  const activeOrder = currentOrder && status === "pending" ? currentOrder : undefined;
  const transferBase = activeOrder?.expectedAmount ?? (amountValid ? amount.trim() : "");
  const transferUnits = tokenAtomicAmount(transferBase, 6);
  const transferTotal = feeUnits !== null && transferUnits !== null
    ? shiftDecimal(String(BigInt(transferUnits) + BigInt(feeUnits)), -6) : null;

  useEffect(() => {
    if (!currentGatewayRef || serverStatus !== "pending") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [currentGatewayRef, serverStatus]);

  async function copy(value: string, target: "amount" | "address" | "total") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied((current) => current === target ? null : current), 1_500);
    } catch {
      setError(t("copyFailed"));
    }
  }

  if (!session) return <Navigate to="/login" />;
  if (!records.data) return <main className="finance-page" aria-busy="true">
    <header><div><span className="eyebrow">USDT · <DataSkeleton /></span><h1>{t("depositTitle")}</h1><p>{t("depositDesc")}</p></div></header>
    <section className="deposit-panel">
      <div className="deposit-asset" aria-label={t("depositAssetNetwork")}>
        <div><span>{t("depositAsset")}</span><strong>USDT</strong></div>
        <div><span>{t("depositNetwork")}</span><div className="deposit-network-trigger"><DataSkeleton /></div></div>
      </div>
      <form className="deposit-order-form">
        <div className="deposit-amount-field"><label htmlFor="deposit-amount-loading">{t("depositAmount")}<input id="deposit-amount-loading" inputMode="decimal" placeholder="100.00" disabled /></label><small>{t("depositAmountHint")}</small></div>
        <Button className="deposit-create-button" size="lg" disabled><ArrowDownToLine />{t("createDepositOrder")}</Button>
      </form>
    </section>
    <section className="transaction-panel">
      <div className="section-title"><h2>{t("depositRecords")}</h2><DataSkeleton /></div>
      {[0, 1, 2].map((item) => <article className="transaction-row" key={item}><div className="transaction-icon"><ArrowDownToLine /></div><div><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div><div className="deposit-record-result"><strong><DataSkeleton /></strong><small><DataSkeleton /></small></div></article>)}
    </section>
  </main>;

  return <main className="finance-page">
    <header><div><span className="eyebrow">USDT{selectedNetworkStatus ? ` · ${selectedNetworkStatus.standard}` : ""}</span><h1>{t("depositTitle")}</h1><p>{t("depositDesc")}</p></div></header>
    <section className="deposit-panel">
      <div className="deposit-asset" aria-label={t("depositAssetNetwork")}> 
        <div><span>{t("depositAsset")}</span><strong>USDT</strong></div>
        <div><span>{t("depositNetwork")}</span>
          <Select value={selectedNetwork ?? undefined} onValueChange={(value) => { setNetworkChoice(value as DepositNetwork); setError(""); setCopied(null); setNow(Date.now()); }} disabled={mutation.isPending || networks.length === 0}>
            <SelectTrigger className="deposit-network-trigger" aria-label={t("depositNetworkSelect")} data-testid="deposit-network-select"><SelectValue placeholder={t("selectDepositNetwork")} /></SelectTrigger>
            <SelectContent>{networks.map((item) => <SelectItem key={item.network} value={item.network} disabled={!item.enabled || !item.ready}>{t(`depositNetworkName.${item.network}`)}{!item.enabled || !item.ready ? ` · ${t("maintenance")}` : ""}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      {flags.deposits ? <form className="deposit-order-form" onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (amountValid && selectedNetwork && selectedNetworkAvailable) mutation.mutate({ network: selectedNetwork, requestedAmount: amount.trim() });
      }}>
        <div className="deposit-amount-field">
          <label htmlFor="deposit-amount">{t("depositAmount")}
            <input
              id="deposit-amount"
              data-testid="deposit-amount-input"
              inputMode="decimal"
              autoComplete="off"
              maxLength={10}
              value={amount}
              aria-invalid={touched && !amountValid}
              aria-describedby="deposit-amount-help"
              placeholder="100.00"
              onChange={(event) => { setAmount(event.target.value); setTouched(true); setError(""); }}
            />
          </label>
          <small id="deposit-amount-help">{t("depositAmountHint")}</small>
          {touched && !amountValid && <p role="alert" className="error">{t("invalidDepositAmount")}</p>}
        </div>
        <Button className="deposit-create-button" size="lg" type="submit" disabled={!amountValid || !selectedNetworkAvailable || mutation.isPending || cancelMutation.isPending || (serverStatus === "pending" && secondsLeft > 0)}>
          <ArrowDownToLine />{mutation.isPending ? t("creating") : t("createDepositOrder")}
        </Button>
      </form> : <div className="feature-disabled"><ShieldCheck /><p>{t("featureUnavailable")}</p></div>}
      {flags.deposits && <details className="deposit-fee-calculator">
        <summary>{t("depositFeeCalculator")}</summary>
        <div className="deposit-fee-calculator-content">
          <div className="deposit-fee-notice" role="note" data-testid="deposit-fee-notice">
            <strong>{t("depositFeePlatformFree")}</strong>
            <p>{t("depositFeeChargedBySender")}</p>
          </div>
          <div className="deposit-amount-field">
            <label htmlFor="deposit-transfer-fee">{t("depositTransferFee")}
              <input id="deposit-transfer-fee" inputMode="decimal" autoComplete="off" maxLength={14}
                value={fee} aria-invalid={feeUnits === null} aria-describedby="deposit-fee-help"
                onChange={(event) => { if (selectedNetwork) setFees((current) => ({ ...current, [selectedNetwork]: event.target.value })); setCopied(null); }} />
            </label>
            <small id="deposit-fee-help">{t("depositTransferFeeHint")}</small>
            {feeUnits === null && <p role="alert" className="error">{t("invalidDepositTransferFee")}</p>}
          </div>
          <div className="deposit-transfer-summary" aria-live="polite">
            <div><span>{t(activeOrder ? "depositTransferTotal" : "depositTransferEstimate")}</span><strong data-testid="deposit-transfer-total">{transferTotal ?? "—"} USDT</strong></div>
            <Button type="button" variant="outline" disabled={!activeOrder || transferTotal === null || cancelMutation.isPending}
              onClick={() => { if (transferTotal !== null) void copy(transferTotal, "total"); }} aria-label={t("copyTransferTotal")}>
              {copied === "total" ? <Check /> : <Copy />}{copied === "total" ? t("copied") : t("copy")}
            </Button>
            <small>{t(activeOrder ? "depositTransferTotalHint" : "depositTransferEstimateHint")}</small>
          </div>
        </div>
      </details>}
      {flags.deposits && !selectedNetworkAvailable && <div className="feature-disabled" role="status"><ShieldCheck /><p>{t("depositNetworkUnavailable")}</p></div>}
      {error && <p role="alert" className="error">{error}</p>}

      {currentOrder && <article className="deposit-order" data-testid="deposit-current-order" data-status={status} aria-live="polite">
        <div className="deposit-order-heading">
          <div><span>{t("depositOrder")} · {t(`depositNetworkName.${currentOrder.network}`)}</span><strong className={`deposit-status ${status}`}>{t(`depositStatus.${status}`)}</strong></div>
          {status === "pending" && <span className="deposit-countdown"><Clock3 />{formatCountdown(secondsLeft)}</span>}
        </div>
        {status === "cancelled" ? <div className="deposit-network-warning" role="note" data-testid="deposit-cancelled-terminal">
          <AlertTriangle />
          <p><strong>{t("depositCancelledTerminal")}</strong><span>{t("orderNumber")}: <code>{currentOrder.gatewayRef}</code></span></p>
        </div> : <>
          <div className="deposit-amount-due">
          <span>{t("exactPaymentAmount")}</span>
          <strong data-testid="deposit-expected-amount">{formatDecimal(currentOrder.expectedAmount)} <small>USDT</small></strong>
          <Button type="button" variant="outline" disabled={status !== "pending" || cancelMutation.isPending} onClick={() => copy(currentOrder.expectedAmount, "amount")} aria-label={t("copyPaymentAmount")}>
            {copied === "amount" ? <Check /> : <Copy />}{copied === "amount" ? t("copied") : t("copy")}
          </Button>
          </div>
          <p className="deposit-exact-warning"><AlertTriangle />{t("exactAmountWarning")}</p>
          {status === "pending" && currentOrder.cancellable && <div className="deposit-cancel-action">
            <Button
              type="button"
              variant="outline"
              data-testid="cancel-deposit-order"
              disabled={cancelMutation.isPending}
              onClick={() => {
                if (window.confirm(t("cancelDepositConfirm"))) cancelMutation.mutate(currentOrder.gatewayRef);
              }}
            >
              <XCircle />{cancelMutation.isPending ? t("cancellingDeposit") : t("cancelDepositOrder")}
            </Button>
          </div>}
          <div className="deposit-order-metrics">
            <div><span>{t("requestedAmount")}</span><strong>{formatDecimal(currentOrder.requestedAmount)} USDT</strong></div>
            <div><span>{t("creditedEstimate")}</span><strong>+{currentOrder.creditedEstimate} USD</strong></div>
            <div><span>{t("expiresIn")}</span><strong>{status === "pending" ? formatCountdown(secondsLeft) : t(`depositStatus.${status}`)}</strong></div>
          </div>
          <div className={`deposit-payment-target${status === "pending" ? "" : " address-only"}`}>
            {status === "pending" && <div className="deposit-qr" data-testid="deposit-address-qr" data-value={currentPaymentQrValue}>
              <QRCodeSVG value={currentPaymentQrValue} size={180} level="M" marginSize={4} title={t("depositQrTitle")} />
              <strong>{t("scanToPay")}</strong>
              <small>{t(currentOrder.network === "SOL" ? "depositQrSolanaHint" : currentPaymentQrValue === currentOrder.address ? "depositQrAddressOnlyHint" : "depositQrAmountHint")}</small>
            </div>}
            <div className="deposit-address">
              <div className="deposit-receiving-network" data-testid="deposit-receiving-network">{t(`depositReceivingNetworkName.${currentOrder.network}`)}</div>
              <span>{currentOrder.network === "SOL" ? t("solanaWalletAddress") : t("receivingAddress")}</span>
              <strong data-testid="deposit-address">{currentOrder.address}</strong>
              <Button type="button" variant="outline" disabled={status !== "pending" || cancelMutation.isPending} onClick={() => copy(currentOrder.address, "address")} aria-label={t("copyReceivingAddress")}>
                {copied === "address" ? <Check /> : <Copy />}{copied === "address" ? t("copied") : t("copy")}
              </Button>
              <small>{t("orderNumber")}: <code data-testid="gateway-ref">{currentOrder.gatewayRef}</code></small>
            </div>
          </div>
          {currentNetworkStatus && <div className="deposit-network-warning" role="note">
            <ShieldCheck />
            <p><strong>{t("networkOnlyWarning", { network: t(`depositNetworkName.${currentNetworkStatus.network}`) })}</strong><span>{currentNetworkStatus.network === "SOL" ? t("usdtTokenMint") : t("usdtContract")}: <code>{currentNetworkStatus.tokenContract}</code></span></p>
          </div>}
        </>}
      </article>}
      <span className="sr-only" aria-live="polite">{copied ? t("copied") : ""}</span>
    </section>
    <section className="transaction-panel">
      <div className="section-title"><h2>{t("depositRecords")}</h2><span>{t("records", { count: records.data.data.length })}</span></div>
      {records.data.data.length === 0 ? <div className="empty-state">{t("noDeposits")}</div> :
        records.data.data.map((item) => <article className="transaction-row" key={item.gatewayRef}>
          <div className="transaction-icon"><ArrowDownToLine /></div>
          <div><strong>{item.currency} · {t(`depositNetworkName.${item.network}`)}</strong><small>{item.status === "cancelled" ? `${t("orderNumber")}: ${item.gatewayRef}` : (item.txHash ?? item.address)}</small></div>
          <div className="deposit-record-result"><strong className={item.status === "confirmed" ? "positive" : ""}>{item.status === "confirmed" ? (item.creditedAmount ? `+$${formatDecimal(item.creditedAmount)}` : "—") : (item.expectedAmount ? `${formatDecimal(item.expectedAmount)} ${item.currency}` : "—")}</strong><small>{t(`depositStatus.${item.status}`)}</small></div>
        </article>)}
    </section>
  </main>;
}
