import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

type Confirm = (message: string) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const confirm = useCallback<Confirm>((description) => {
    if (pending.current) return Promise.resolve(false);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setMessage(description);
    });
  }, []);
  const finish = (confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setMessage(null);
    resolve?.(confirmed);
  };
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);

  return <ConfirmContext.Provider value={confirm}>
    {children}
    <AlertDialog.Root open={message !== null} onOpenChange={(open) => { if (!open) finish(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog-content confirmation-dialog" onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}>
          <AlertDialog.Title>{t("confirmAction")}</AlertDialog.Title>
          <AlertDialog.Description>{message}</AlertDialog.Description>
          <div className="confirmation-actions">
            <AlertDialog.Cancel asChild><Button type="button" variant="outline" onClick={() => finish(false)}>{t("cancel")}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button type="button" onClick={() => finish(true)}>{t("confirmAction")}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </ConfirmContext.Provider>;
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm requires ConfirmProvider");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useCallback(async (message: string) => (await confirm(message)) && mounted.current, [confirm]);
}
