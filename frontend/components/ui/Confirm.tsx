"use client";

import { AlertTriangle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type Options = { title: string; body?: string; confirmLabel?: string; danger?: boolean };
type ConfirmFn = (o: Options) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

/** `const ok = await confirm({...})`: a branded replacement for window.confirm. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    return new Promise<boolean>((res) => {
      resolver.current = res;
    });
  }, []);

  const close = (v: boolean) => {
    resolver.current(v);
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal open={!!opts} onClose={() => close(false)} size="sm" title={opts?.title ?? ""}
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>Keep it</Button>
          <Button variant={opts?.danger === false ? "primary" : "danger"} onClick={() => close(true)} autoFocus>{opts?.confirmLabel ?? "Confirm"}</Button>
        </>}>
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-kenya-red"><AlertTriangle className="size-5" /></span>
          <p className="text-sm text-slate-700">{opts?.body}</p>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx);
  if (!fn) throw new Error("useConfirm must be used inside ConfirmProvider");
  return fn;
}
