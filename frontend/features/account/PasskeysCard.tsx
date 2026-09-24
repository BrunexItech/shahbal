"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Fingerprint, KeyRound, Smartphone, Trash2, Usb } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SkeletonRows } from "@/components/loaders";
import { Badge, Button, Card, CardHeader, Input, Modal, useConfirm } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateTime, timeAgo } from "@/lib/format";
import { defaultPasskeyName, passkeyErrorMessage, passkeySupport, registerPasskey } from "@/lib/passkeys";

type Passkey = { id: string; name: string; kind: "platform" | "security_key"; backed_up: boolean; created_at: string; last_used_at: string | null };

export function PasskeysCard() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["account", "passkeys"], queryFn: () => api<Passkey[]>("/auth/passkeys") });
  const [support, setSupport] = useState({ webauthn: false, platform: false, autofill: false });
  const [adding, setAdding] = useState<"platform" | "security_key" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => void passkeySupport().then(setSupport), []);

  const reload = async () => {
    await qc.invalidateQueries({ queryKey: ["account"] });
    await refresh();
  };

  async function add() {
    if (!adding) return;
    setBusy(true);
    try {
      await registerPasskey(adding, name.trim() || defaultPasskeyName(adding));
      toast.success(adding === "platform" ? "Passkey added. You can now sign in with your fingerprint or face." : "Security key added");
      setAdding(null);
      await reload();
    } catch (e) {
      toast.error(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Passkey) {
    if (!(await confirm({ title: `Remove "${p.name}"?`, body: "You won't be able to sign in with it any more.", confirmLabel: "Remove passkey" }))) return;
    try {
      await api(`/auth/passkeys/${p.id}`, { method: "DELETE" });
      toast.success("Passkey removed");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove it");
    }
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Passkeys" subtitle="Sign in with your fingerprint, face, phone PIN or a hardware security key. Your biometrics never leave your device; we only store a public key."
        action={<Badge tone={data?.length ? "green" : "amber"} dot>{data?.length ? `${data.length} active` : "None yet"}</Badge>} />
      {!support.webauthn ? (
        <p className="p-5 text-sm text-muted">This browser doesn&apos;t support passkeys. Try the latest Chrome, Safari or Edge.</p>
      ) : (
        <>
          {isLoading ? <SkeletonRows rows={2} cols={3} /> : data?.length ? (
            <ul className="divide-y divide-line">
              {data.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 place-items-center rounded-xl bg-kenya-green-50 text-kenya-green">
                    {p.kind === "security_key" ? <Usb className="size-5" /> : <Fingerprint className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold text-navy-900">
                      {p.name}
                      {p.backed_up && <span title="Synced to your password manager, so it works on your other devices too"><Cloud className="size-3.5 text-ocean" /></span>}
                    </p>
                    <p className="text-xs text-muted">Added {dateTime(p.created_at)} · {p.last_used_at ? `last used ${timeAgo(p.last_used_at)}` : "not used yet"}</p>
                  </div>
                  <button onClick={() => remove(p)} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-kenya-red" aria-label={`Remove ${p.name}`}>
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pt-5 text-sm text-slate-700">Add a passkey and you&apos;ll never need to type your password on this device again, and it can&apos;t be phished.</p>
          )}
          <div className="flex flex-wrap gap-2 p-5">
            {support.platform && (
              <Button icon={<Smartphone className="size-4" />} onClick={() => { setAdding("platform"); setName(defaultPasskeyName("platform")); }}>
                Add this device (fingerprint / face)
              </Button>
            )}
            <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => { setAdding("security_key"); setName(defaultPasskeyName("security_key")); }}>
              Add a security key
            </Button>
          </div>
        </>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} size="sm"
        title={adding === "security_key" ? "Add a security key" : "Add a passkey on this device"}
        subtitle={adding === "security_key" ? "Have your key ready (USB or NFC). You'll be asked to touch it and enter its PIN." : "Your device will ask for your fingerprint, face or screen lock."}
        footer={<><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button loading={busy} onClick={add} icon={<Fingerprint className="size-4" />}>Continue</Button></>}>
        <Input label="Name it" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} hint="So you can tell your passkeys apart, e.g. 'Work phone'" />
      </Modal>
    </Card>
  );
}
