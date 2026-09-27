"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AudioLines, Info, Mic, MicOff, Phone, PhoneOff, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button, Card, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CANDIDATE_NAME } from "@/lib/config";

type Line = { id: number; who: "caller" | "assistant"; text: string };

// Audio processing runs from our own site (copied at build time), so the strict security policy stays as is.
const SELF_HOSTED = {
  workletPaths: { rawAudioProcessor: "/elevenlabs/rawAudioProcessor.js", audioConcatProcessor: "/elevenlabs/audioConcatProcessor.js" },
  libsampleratePath: "/elevenlabs/libsamplerate.worklet.js",
};

export default function TalkToShahbalPage() {
  const status = useQuery({ queryKey: ["voice-assistant"], queryFn: () => api<{ enabled: boolean }>("/voice-assistant/status") });
  return (
    <>
      <PageHeader eyebrow="Outreach" title="Talk to Shahbal"
        subtitle="Try the phone assistant from here: it's the same voice, greeting and answers callers will get on the phone line." />
      {status.data && !status.data.enabled ? (
        <Card className="flex items-start gap-3 p-5 text-sm text-slate-600">
          <Info className="mt-0.5 size-5 shrink-0 text-ocean" />
          The assistant isn&apos;t set up on this server yet. Add ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and ELEVENLABS_AGENT_ID to backend/.env.
        </Card>
      ) : (
        <ConversationProvider>
          <Console />
        </ConversationProvider>
      )}
    </>
  );
}

function Console() {
  const [lines, setLines] = useState<Line[]>([]);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const seq = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const convo = useConversation({
    onMessage: (m) => { if (m.message?.trim()) setLines((l) => [...l, { id: ++seq.current, who: m.role === "user" ? "caller" : "assistant", text: m.message }]); },
    onError: (message) => { console.error("voice assistant error:", message); toast.error(typeof message === "string" ? message : "The conversation stopped unexpectedly"); },
    onDisconnect: (d) => {
      console.info("voice assistant ended:", JSON.stringify(d));
      if (d.reason === "error") toast.error(`The conversation ended: ${d.message || "connection problem"}`);
    },
  });
  const live = convo.status === "connected";
  const refresh = useMutation({
    mutationFn: () => api<{ knowledge_chars: number }>("/voice-assistant/refresh", { method: "POST" }),
    onSuccess: () => toast.success("The assistant now knows the latest published About, agenda, events and news."),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [lines.length]);
  useEffect(() => {
    if (!live) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => () => { convo.endSession(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- leaving the page hangs up

  const start = async () => {
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }); // ask for the microphone first, with a clear message if refused
      const { signed_url } = await api<{ signed_url: string }>("/voice-assistant/session", { method: "POST" });
      setLines([]);
      convo.startSession({ signedUrl: signed_url, ...SELF_HOSTED });
    } catch (e) {
      toast.error(e instanceof DOMException ? "Allow the microphone for this site to talk to the assistant." : e instanceof Error ? e.message : "Couldn't start");
    } finally {
      setStarting(false);
    }
  };

  const state = convo.status === "connecting" || starting ? "Connecting…" : !live ? "Ready" : convo.isSpeaking ? "Speaking" : "Listening";
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center bg-gradient-to-b from-[#0a1830] to-[#06101f] px-6 py-8 text-white">
          <span className="relative grid size-28 place-items-center">
            {live && <span aria-hidden className={cn("absolute inset-0 rounded-full bg-gold/25", convo.isSpeaking ? "animate-ping" : "")} />}
            <span aria-hidden className={cn("absolute -inset-1.5 rounded-full ring-2 transition", live ? (convo.isSpeaking ? "ring-gold" : "ring-[#34c77b]/70") : "ring-white/10")} />
            <span className="relative grid size-24 place-items-center rounded-full bg-gradient-to-br from-gold to-[#8a6d12] text-navy-950"><AudioLines className="size-10" /></span>
          </span>
          <p className="mt-4 font-display text-lg font-bold">{CANDIDATE_NAME}</p>
          <p className="text-xs text-slate-400">AI phone assistant · his voice, with his approval</p>
          <p className={cn("mt-3 rounded-full px-3 py-1 text-xs font-bold", live ? "bg-[#34c77b]/15 text-[#7ee2b0]" : "bg-white/10 text-slate-300")}>
            {state}{live && ` · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
          </p>
        </div>
        <div className="space-y-3 p-5">
          {!live ? (
            <div className="flex justify-center">
              <Button icon={<Phone className="size-4" />} loading={starting || convo.status === "connecting"} onClick={() => void start()}>
                Start test conversation
              </Button>
            </div>
          ) : (
            <div className="flex justify-center gap-2">
              <Button variant="secondary" icon={convo.isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />} onClick={() => convo.setMuted(!convo.isMuted)}>
                {convo.isMuted ? "Unmute" : "Mute"}
              </Button>
              <Button variant="danger" icon={<PhoneOff className="size-4" />} onClick={() => convo.endSession()}>End</Button>
            </div>
          )}
          <ul className="space-y-1.5 text-xs text-slate-500">
            <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-kenya-green" /> It only uses what's published on the website, and never asks for ID or M-Pesa details.</li>
            <li className="flex gap-2"><Info className="size-4 shrink-0 text-ocean" /> Speak English or Kiswahili. Each test uses ElevenLabs minutes, like a real call.</li>
          </ul>
          <div className="border-t border-line pt-3">
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} loading={refresh.isPending} disabled={live} onClick={() => refresh.mutate()}>
              Refresh what it knows
            </Button>
            <p className="mt-1.5 text-xs text-slate-500">It updates by itself within a minute of anything published on the website. Press this to update it straight away.</p>
          </div>
        </div>
      </Card>

      <Card className="flex min-h-[420px] flex-col">
        <div className="border-b border-line px-5 py-3"><p className="text-sm font-bold text-navy-900">Conversation</p><p className="text-xs text-slate-500">What was said, as it happens.</p></div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5" aria-live="polite">
          {!lines.length ? (
            <p className="py-16 text-center text-sm text-slate-400">{live ? "Say hello…" : "Start a test conversation to hear the assistant."}</p>
          ) : lines.map((l) => (
            <div key={l.id} className={cn("flex", l.who === "caller" ? "justify-end" : "justify-start")}>
              <p className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", l.who === "caller" ? "rounded-br-md bg-ocean-50 text-navy-900" : "rounded-bl-md bg-navy-950 text-white")}>
                <span className={cn("mb-0.5 block text-xs font-semibold", l.who === "caller" ? "text-ocean" : "text-gold")}>{l.who === "caller" ? "You" : "Assistant"}</span>
                {l.text}
              </p>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      </Card>
    </div>
  );
}
