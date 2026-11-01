import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, Children, isValidElement, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Tone = "error" | "success" | "warning" | "info";
type Notification = { id: string; text: string; tone: Tone; content: ReactNode; attributes: HTMLAttributes<HTMLDivElement> };
type Notices = { publish: (notice: Notification, updateOnly: boolean) => void; detach: (id: string) => void; attach: (host: HTMLElement) => () => void };
const NoticeContext = createContext<Notices | null>(null);

function messageText(content: ReactNode): string {
  return Children.toArray(content).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? messageText(child.props.children) : "";
  }).join(" ").replace(/\s+/g, " ").trim();
}

function NotificationCard({ notice, dismiss }: { notice: Notification; dismiss: (id: string) => void }) {
  const { i18n } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(notice.tone === "success" || notice.tone === "info" ? 6000 : 10000);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(notice.id), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current -= Date.now() - started; };
  }, [dismiss, notice.id, paused]);
  const Icon = { error: AlertCircle, success: CheckCircle2, warning: TriangleAlert, info: Info }[notice.tone];
  return <div {...notice.attributes} className={`notification-card is-${notice.tone}`} role={notice.tone === "error" || notice.tone === "warning" ? "alert" : "status"}
    aria-atomic="true" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Icon className="notification-icon" aria-hidden="true" />
    <div className="notification-content">{notice.content}</div>
    <button className="notification-close" type="button" aria-label={i18n.language.startsWith("zh") ? "关闭提示" : "Dismiss notification"} onClick={() => dismiss(notice.id)}><X size={16} aria-hidden="true" /></button>
  </div>;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notification[]>([]);
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  const attach = useCallback((host: HTMLElement) => {
    setHosts(current => [...current, host]);
    return () => setHosts(current => current.filter(item => item !== host));
  }, []);
  const dismiss = useCallback((id: string) => setNotices(current => current.filter(item => item.id !== id)), []);
  const publish = useCallback((notice: Notification, updateOnly: boolean) => {
    setNotices(current => {
      const existing = current.find(item => item.id === notice.id);
      if (existing) return current.map(item => item.id === notice.id ? notice : item);
      if (updateOnly) return current;
      const duplicate = current.find(item => item.text === notice.text && item.tone === notice.tone);
      if (duplicate) return current.map(item => item === duplicate ? notice : item);
      return [...current, notice].slice(-5);
    });
  }, []);
  // Keep the message across navigation, but release callbacks owned by the departed page.
  const detach = useCallback((id: string) => setNotices(current => current.map(item => item.id === id ? { ...item, content: item.text } : item)), []);
  const context = useMemo(() => ({ publish, detach, attach }), [publish, detach, attach]);
  return <NoticeContext.Provider value={context}>{children}{createPortal(
    <section className="notification-stack" aria-label="Notifications" aria-live="polite" tabIndex={-1} popover="manual"
      ref={element => { if (element?.showPopover && !element.matches(":popover-open")) element.showPopover(); }}>
      {notices.map(notice => <NotificationCard key={`${notice.id}:${notice.tone}:${notice.text}`} notice={notice} dismiss={dismiss} />)}
    </section>, hosts.at(-1) ?? document.body,
  )}</NoticeContext.Provider>;
}

export function Notice({ children, className = "", role, tone, ...attributes }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  const context = useContext(NoticeContext);
  if (!context) throw new Error("Notice requires NoticeProvider");
  const id = useId();
  const text = messageText(children);
  const resolvedTone = tone ?? (/warning/.test(className) ? "warning" : /is-error|\berror\b|cdkv2-alert|copy-error/.test(className) || role === "alert" ? "error" : /is-success|success-note|cdkv2-notice/.test(className) || role === "status" ? "success" : "info");
  const signature = `${resolvedTone}:${text}`;
  const previous = useRef("");
  const { publish, detach } = context;
  useLayoutEffect(() => {
    if (text) publish({ id, text, tone: resolvedTone, content: children, attributes }, previous.current === signature);
    previous.current = signature;
  });
  useLayoutEffect(() => () => detach(id), [detach, id]);
  return null;
}

// Place floating notifications inside an open modal's focus boundary.
export function NoticeScope() {
  const context = useContext(NoticeContext);
  const ref = useRef<HTMLSpanElement>(null);
  const attach = context?.attach;
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (host && attach) return attach(host);
  }, [attach]);
  return <span ref={ref} hidden />;
}
