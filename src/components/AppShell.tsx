import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { Dialog } from "radix-ui";
import {
  BarChart3,
  CreditCard,
  Crown,
  Gift,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Megaphone,
  Network,
  Plus,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StableSwap } from "./StableSwap";
import { BrandIcon } from "@/components/BrandIcon";
import { ApiError, getDashboard, getSupportTickets, getUnreadAnnouncements, logout, markAnnouncementRead } from "../api";
import { useFeatures } from "../features";
import { emptyGptDirectDraft, gptDirectDraftAtom, sessionAtom, sessionIdentity } from "../state";
import { LanguageButton } from "./LanguageButton";

export function AppShell() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (location) => location.pathname });
  const isPublicCdkRoute = pathname === "/cdk/redeem" || pathname === "/x-cdk/redeem" || pathname === "/tg-cdk/redeem";
  const [session, setSession] = useAtom(sessionAtom);
  const setGptDirectDraft = useSetAtom(gptDirectDraftAtom);
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<number[]>([]);
  const [logoutError, setLogoutError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const queryClient = useQueryClient();
  const identity = sessionIdentity(session);
  const previousSessionIdentity = useRef(identity);
  const { flags } = useFeatures();
  useLayoutEffect(() => {
    if (previousSessionIdentity.current !== identity) {
      queryClient.clear();
      setGptDirectDraft(emptyGptDirectDraft());
      previousSessionIdentity.current = identity;
    }
  }, [identity, queryClient, setGptDirectDraft]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousRootOverflow = document.documentElement.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);
  const profile = useQuery({
    queryKey: ["dashboard", identity],
    queryFn: () => getDashboard(session!.token),
    enabled: Boolean(session),
    retry: false,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });
  const announcements = useQuery({
    queryKey: ["announcements", identity],
    queryFn: () => getUnreadAnnouncements(session!.token),
    enabled: Boolean(session),
    refetchInterval: 30_000,
  });
  const supportTickets = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => getSupportTickets(session!.token),
    enabled: Boolean(session),
    refetchInterval: 30_000,
  });
  const supportUnread = supportTickets.data?.data.reduce((total, ticket) => total + ticket.unreadCount, 0) ?? 0;
  const readAnnouncement = useMutation({
    mutationFn: (id: number) => markAnnouncementRead(session!.token, id),
    onSuccess: async (_, id) => {
      setDismissedAnnouncementIds((current) => current.includes(id) ? current : [...current, id]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["announcements"] }),
        queryClient.invalidateQueries({ queryKey: ["announcement-history"] }),
      ]);
    },
  });
  const currentAnnouncement = announcements.data?.data.find((item) => !dismissedAnnouncementIds.includes(item.id));

  if (!session) return isPublicCdkRoute ? <Outlet /> : <Navigate to="/login" />;
  if (profile.error instanceof ApiError && profile.error.errorCode === "AUTH_REQUIRED") {
    queryClient.clear();
    setGptDirectDraft(emptyGptDirectDraft());
    setSession(null);
    localStorage.removeItem("session");
    return isPublicCdkRoute ? <Outlet /> : <Navigate to="/login" />;
  }
  if (profile.isError && !profile.data) return <main className="center"><div role="alert" className="error">
    <p>{profile.error instanceof Error ? profile.error.message : "Request failed"}</p>
    <Button type="button" variant="outline" onClick={() => void profile.refetch()}>{t("retry")}</Button>
  </div></main>;
  const accountLabel = profile.data?.displayName ?? profile.data?.email ?? session.displayName ?? session.email ?? `#${session.userId}`;

  const signOut = async () => {
    try {
      setLogoutError("");
      await logout();
      queryClient.clear();
      setGptDirectDraft(emptyGptDirectDraft());
      setSession(null);
      localStorage.removeItem("session");
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === "AUTH_REQUIRED") {
        queryClient.clear();
        setGptDirectDraft(emptyGptDirectDraft());
        setSession(null);
        localStorage.removeItem("session");
        return;
      }
      setLogoutError(error instanceof Error ? error.message : "Logout failed");
    }
  };
  const linkProps = (label: string) => ({
    className: "sidebar-link",
    "aria-label": label,
    activeProps: { "aria-current": "page" as const },
    onClick: () => setMobileNavOpen(false),
  });

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{t("skipToContent")}</a>
    {mobileNavOpen && <button type="button" className="mobile-sidebar-backdrop" aria-label={t("closeNavigation")} onClick={() => setMobileNavOpen(false)} />}
    <aside className={`app-sidebar ${mobileNavOpen ? "is-mobile-open" : ""}`} data-testid="app-sidebar">
      <button type="button" className="mobile-sidebar-toggle" aria-label={t(mobileNavOpen ? "closeNavigation" : "openNavigation")} aria-controls="app-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
        {mobileNavOpen ? <X /> : <Menu />}
      </button>
      <div className="sidebar-brand">
        <span className="sidebar-logo"><BrandIcon /></span>
        <div><strong>AVANFINITY</strong><small>{t("privateBanking")}</small></div>
      </div>
      <nav id="app-navigation" aria-label={t("mainNavigation")}>
        <span className="sidebar-section">{t("bankingServices")}</span>
        <Link to="/dashboard" {...linkProps(t("overview"))}><LayoutDashboard /><span>{t("overview")}</span></Link>
        <Link to="/cards" {...linkProps(t("openCardCenter"))} activeOptions={{ exact: true }} aria-current={pathname === "/cards" || pathname.startsWith("/cards/open/") ? "page" : undefined}><Plus /><span>{t("openCardCenter")}</span></Link>
        <Link to="/cards/owned" {...linkProps(t("ownedCards"))} aria-current={pathname === "/cards/owned" || /^\/cards\/\d+$/.test(pathname) ? "page" : undefined}><CreditCard /><span>{t("ownedCards")}</span></Link>
        <Link to="/card-transactions" {...linkProps(t("cardTransactions"))}><ReceiptText /><span>{t("cardTransactions")}</span></Link>
        <Link to="/tg-direct" className="sidebar-link" aria-label="TG 直充" aria-current={pathname.startsWith("/tg-direct") ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><Sparkles /><span>TG 直充</span></Link>
        <Link to="/gpt-direct" className="sidebar-link" aria-label={t("gptDirectNavigation")} aria-current={pathname.startsWith("/gpt-direct") ? "page" : undefined} onClick={() => setMobileNavOpen(false)}><Sparkles /><span>{t("gptDirectNavigation")}</span></Link>
        <Link to="/cdk/redeem" {...linkProps(t("cdkRedeemNavigation"))}><KeyRound /><span>{t("cdkRedeemNavigation")}</span></Link>
        <Link to="/tg-cdk/redeem" {...linkProps("TG CDK 兑换")}><KeyRound /><span>TG CDK 兑换</span></Link>
        <Link to="/finance" {...linkProps(t("finance"))}><WalletCards /><span>{t("finance")}</span></Link>
        <Link to="/deposit" {...linkProps(t("deposit"))}><Landmark /><span>{t("deposit")}</span></Link>
        <Link to="/rewards" {...linkProps(t("rewards"))}><Gift /><span>{t("rewards")}</span></Link>
        <Link to="/referral" {...linkProps(t("referral"))}><Network /><span>{t("referral")}</span></Link>
        <Link to="/membership" {...linkProps(t("membership"))}><Crown /><span>{t("membership")}</span></Link>
        <span className="sidebar-section">{t("accountTools")}</span>
        <Link to="/support" {...linkProps(t("supportTickets"))}><LifeBuoy /><span>{t("supportTickets")}</span>{supportUnread > 0 && <b className="sidebar-badge" aria-label={t("unreadSupportMessages", { count: supportUnread })}>{supportUnread > 99 ? "99+" : supportUnread}</b>}</Link>
        <Link to="/announcements" {...linkProps(t("announcementHistory"))}><Megaphone /><span>{t("announcementHistory")}</span>{Boolean(announcements.data?.unreadCount) && <b className="sidebar-badge" aria-label={t("unreadAnnouncements", { count: announcements.data!.unreadCount })}>{announcements.data!.unreadCount > 99 ? "99+" : announcements.data!.unreadCount}</b>}</Link>
        <Link to="/cdk-v2" {...linkProps("CDK 发行中心")}><KeyRound /><span>CDK 发行中心</span></Link>
        <Link to="/developer" {...linkProps("API")}><KeyRound /><span>API</span></Link>
        {flags.market && <Link to="/openai-prices" {...linkProps(t("market"))}><BarChart3 /><span>{t("market")}</span></Link>}
        {profile.data?.role === "admin" && <Link to="/admin" {...linkProps(t("admin"))}><ShieldCheck /><span>{t("admin")}</span></Link>}
        {profile.data?.role === "agent" && flags.agent && <Link to="/agent" {...linkProps(t("agent"))}><Network /><span>{t("agent")}</span></Link>}
        <Link to="/settings" {...linkProps(t("settings"))}><Settings /><span>{t("settings")}</span></Link>
      </nav>
      <div className="sidebar-footer">
        <LanguageButton />
        <div className="sidebar-account">
          <span>{accountLabel.slice(0, 1).toUpperCase()}</span>
          <div><strong>{accountLabel}</strong><small>{profile.data?.role ?? ""}</small></div>
        </div>
        <Button className="sidebar-logout" variant="ghost" size="sm" onClick={signOut} aria-label={t("logout")}>
          <LogOut /><span>{t("logout")}</span>
        </Button>
        {logoutError && <p className="error" role="alert">{logoutError}</p>}
      </div>
    </aside>
    <div className="app-content" id="main-content" tabIndex={-1}><Outlet /></div>
    <Dialog.Root open={Boolean(currentAnnouncement)} onOpenChange={(open) => {
      if (!open && currentAnnouncement) {
        setDismissedAnnouncementIds((current) => current.includes(currentAnnouncement.id) ? current : [...current, currentAnnouncement.id]);
        readAnnouncement.reset();
      }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content announcement-dialog">
          <div className="announcement-dialog-heading"><span><Megaphone /></span><div><small>{t("systemAnnouncement")}</small><Dialog.Title>{currentAnnouncement?.title}</Dialog.Title></div></div>
          <Dialog.Description className="announcement-dialog-body">{currentAnnouncement?.content}</Dialog.Description>
          {readAnnouncement.isError && <p className="error" role="alert">{t("announcementReadFailed")}</p>}
          <div className="announcement-dialog-actions">
            <Button variant="outline" onClick={() => {
              if (currentAnnouncement) setDismissedAnnouncementIds((current) => current.includes(currentAnnouncement.id) ? current : [...current, currentAnnouncement.id]);
              readAnnouncement.reset();
            }}>{t("remindNextLogin")}</Button>
            <Button onClick={() => currentAnnouncement && readAnnouncement.mutate(currentAnnouncement.id)} disabled={readAnnouncement.isPending}><StableSwap state={readAnnouncement.isPending ? "busy" : "idle"} labels={{ idle: t("acknowledgeAnnouncement"), busy: t("processing") }} /></Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
