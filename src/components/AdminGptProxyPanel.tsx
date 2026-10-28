import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  addAdminGptProxy,
  commandAdminGptProxy,
  getAdminGptProxies,
  probeAdminGptProxies,
  type AdminGptProxy,
} from "../api";
import { Button } from "./ui/button";
import { StableSwap } from "./StableSwap";

function proxyStateClass(state: AdminGptProxy["state"]) {
  if (state === "healthy") return "is-active";
  if (state === "unhealthy") return "is-error";
  return "";
}

export function AdminGptProxyPanel({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-US" : "zh-CN";
  const client = useQueryClient();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [expectedCountry, setExpectedCountry] = useState("PH");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");

  const pool = useQuery({
    queryKey: ["admin-gpt-proxies"],
    queryFn: () => getAdminGptProxies(token),
    retry: false,
    refetchInterval: 15_000,
  });

  const add = useMutation({
    mutationFn: () => addAdminGptProxy(token, { url: url.trim(), label: label.trim(), expectedCountry: expectedCountry.trim().toUpperCase() }),
    onSuccess: async () => {
      setUrl("");
      setLabel("");
      await client.invalidateQueries({ queryKey: ["admin-gpt-proxies"] });
    },
  });

  const probeAll = useMutation({
    mutationFn: () => probeAdminGptProxies(token),
    onSuccess: async (response) => {
      client.setQueryData(["admin-gpt-proxies"], response);
    },
  });

  async function runCommand(id: string, action: "probe" | "enable" | "disable" | "delete") {
    if (busyId) return;
    setBusyId(`${id}:${action}`);
    try {
      const response = await commandAdminGptProxy(token, id, action);
      client.setQueryData(["admin-gpt-proxies"], response);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      setBusyId("");
    }
  }

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim() || add.isPending) return;
    add.reset();
    probeAll.reset();
    setActionError("");
    add.mutate();
  }

  const data = pool.data?.data;
  const pending = add.isPending || probeAll.isPending || Boolean(busyId);

  return <div className="admin-panel-stack" data-testid="admin-panel-proxies">
    <div className="admin-panel-heading">
      <div>
        <span className="admin-kicker">GPT DIRECT</span>
        <h2>{t("adminGptProxies")}</h2>
        <p>{t("adminGptProxiesDesc")}</p>
      </div>
      <div className="admin-heading-actions">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setActionError(""); probeAll.mutate(); }}>
          <RefreshCw /><StableSwap state={probeAll.isPending ? "busy" : "idle"} labels={{ idle: t("gptProxyProbeAll"), busy: t("gptProxyProbing") }} />
        </Button>
      </div>
    </div>

    <section className="admin-surface">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">POOL</span><h3>{t("gptProxyPool")}</h3><p>{t("gptProxyPoolHint")}</p></div>
        <Wifi />
      </div>
      <dl className="admin-proxy-metrics">
        <div><dt>{t("gptProxyTotal")}</dt><dd>{data?.total ?? 0}</dd></div>
        <div><dt>{t("gptProxyHealthy")}</dt><dd>{data?.healthy ?? 0}</dd></div>
        <div><dt>{t("gptProxyRoutable")}</dt><dd>{data?.routable ?? 0}</dd></div>
        <div><dt>{t("gptProxyInterval")}</dt><dd>{data?.intervalSeconds ? `${data.intervalSeconds}s` : t("gptProxyManual")}</dd></div>
      </dl>
      <form className="admin-proxy-add" data-testid="admin-proxy-add" onSubmit={submitAdd}>
        <label>{t("gptProxyUrl")}
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="socks5h://USER:PASSWORD@HOST:PORT"
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            required
          />
        </label>
        <label>{t("gptProxyLabel")}
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("optional")} disabled={pending} />
        </label>
        <label>{t("gptProxyExpectedCountry")}
          <input
            value={expectedCountry}
            onChange={(event) => setExpectedCountry(event.target.value.toUpperCase())}
            maxLength={2}
            placeholder="PH"
            disabled={pending}
            required
          />
        </label>
        <Button type="submit" size="sm" disabled={pending || !url.trim()}><Plus />{t("gptProxyAdd")}</Button>
      </form>
      {(pool.isError || add.isError || probeAll.isError || actionError) && <p className="admin-alert is-error" role="alert">
        {actionError
          || (add.error instanceof Error ? add.error.message : "")
          || (probeAll.error instanceof Error ? probeAll.error.message : "")
          || (pool.error instanceof Error ? pool.error.message : t("adminLoadFailed"))}
      </p>}
    </section>

    <section className="admin-surface">
      <div className="admin-section-heading">
        <div><span className="admin-kicker">EXITS</span><h3>{t("gptProxyList")}</h3><p>{t("gptProxyListHint")}</p></div>
        <span>{data?.proxies.length ?? 0}</span>
      </div>
      {pool.isLoading && <p className="admin-state loading-skeleton loading-skeleton-table" aria-label={t("loading")}>{t("loading")}</p>}
      {data?.proxies.length === 0 && <p className="admin-state">{t("gptProxyEmpty")}</p>}
      {data && data.proxies.length > 0 && <div className="admin-table-wrap"><table className="admin-table" data-testid="admin-proxies-table">
        <thead><tr>
          <th>{t("gptProxyExit")}</th>
          <th>{t("gptProxyCountry")}</th>
          <th>{t("status")}</th>
          <th>{t("gptProxyLatency")}</th>
          <th>{t("gptProxyExitIp")}</th>
          <th>{t("gptProxyLastCheck")}</th>
          <th>{t("actions")}</th>
        </tr></thead>
        <tbody>{data.proxies.map((item) => {
          const rowBusy = busyId.startsWith(`${item.id}:`);
          return <tr key={item.id}>
            <td>
              <strong>{item.host}:{item.port}</strong>
              <small>{item.label || item.scheme} · {item.masked}{item.expectedCountry ? ` · ${item.expectedCountry}` : ""}</small>
            </td>
            <td>{item.country || "—"}{item.city ? <small>{item.city}</small> : null}</td>
            <td>
              <span className={`status-pill ${proxyStateClass(item.state)}`}>{t(`gptProxyState.${item.state}`)}</span>
              {!item.routable && item.enabled ? <small>{t("gptProxyDerouted")}</small> : null}
              {item.lastError ? <small className="is-error">{item.lastError}</small> : null}
            </td>
            <td>{item.latencyMs > 0 ? `${item.latencyMs} ms` : "—"}</td>
            <td>{item.exitIp ? <code>{item.exitIp}</code> : "—"}</td>
            <td>{item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString(locale) : t("gptProxyNeverChecked")}</td>
            <td className="admin-row-actions">
              <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => void runCommand(item.id, "probe")}><StableSwap state={rowBusy && busyId.endsWith(":probe") ? "busy" : "idle"} labels={{ idle: t("gptProxyProbe"), busy: t("gptProxyProbing") }} /></Button>
              {item.enabled
                ? <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => void runCommand(item.id, "disable")}>{t("disable")}</Button>
                : <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => void runCommand(item.id, "enable")}>{t("enable")}</Button>}
              <Button type="button" size="xs" variant="destructive" disabled={pending} onClick={() => void runCommand(item.id, "delete")}>{t("delete")}</Button>
            </td>
          </tr>;
        })}</tbody>
      </table></div>}
    </section>
  </div>;
}
