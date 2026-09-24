"use client";

/**
 * Browser softphone. One interface, two lines:
 *   - SipLine: real calls over SIP-over-WebSocket + WebRTC (SIP.js), for
 *     Africa's Talking SIP, Yeastar, Asterisk or any compliant carrier.
 *   - SandboxLine: a simulated carrier (ringback, a synthetic "voice", DTMF)
 *     for training and development. Same UI, same recording pipeline.
 */
export type LineState = "offline" | "connecting" | "ready" | "dialing" | "ringing" | "in_call" | "ended" | "error";

export type SoftphoneConfig = {
  provider: "sandbox" | "sip";
  caller_id: string | null;
  stun: string[];
  recording_retention_days: number;
  wss_url?: string;
  domain?: string;
  uri?: string;
  username?: string;
  password?: string;
};

export interface Line {
  readonly kind: "sip" | "sandbox";
  state: LineState;
  held: boolean;
  muted: boolean;
  error?: string;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  connect(): Promise<void>;
  call(number: string): Promise<void>;
  hangup(): Promise<void>;
  setMuted(on: boolean): void;
  setHeld(on: boolean): Promise<void>;
  dtmf(tone: string): Promise<void>;
  dispose(): Promise<void>;
  onChange(cb: () => void): () => void;
}

// ---- shared audio helpers ---------------------------------------------------------
let ctx: AudioContext | null = null;
export const audioCtx = () => (ctx ??= new AudioContext());

const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477], "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477], "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

/** Plays the real dual-tone pair locally so agents hear their keypresses. */
export function playDtmf(tone: string) {
  const f = DTMF[tone];
  if (!f) return;
  const a = audioCtx();
  const g = a.createGain();
  g.gain.value = 0.08;
  g.connect(a.destination);
  for (const hz of f) {
    const o = a.createOscillator();
    o.frequency.value = hz;
    o.connect(g);
    o.start();
    o.stop(a.currentTime + 0.14);
  }
}

async function microphone(): Promise<MediaStream | undefined> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    return undefined; // no mic / permission denied: the call UI still works, recording has one side
  }
}

abstract class BaseLine implements Line {
  abstract readonly kind: "sip" | "sandbox";
  state: LineState = "offline";
  held = false;
  muted = false;
  error?: string;
  localStream?: MediaStream;
  remoteStream?: MediaStream;
  private subs = new Set<() => void>();
  onChange(cb: () => void) {
    this.subs.add(cb);
    return () => void this.subs.delete(cb);
  }
  protected set(state: LineState, error?: string) {
    this.state = state;
    this.error = error;
    this.subs.forEach((s) => s());
  }
  protected emit() {
    this.subs.forEach((s) => s());
  }
  abstract connect(): Promise<void>;
  abstract call(number: string): Promise<void>;
  abstract hangup(): Promise<void>;
  abstract setMuted(on: boolean): void;
  abstract setHeld(on: boolean): Promise<void>;
  abstract dtmf(tone: string): Promise<void>;
  abstract dispose(): Promise<void>;
}

// ---- sandbox ---------------------------------------------------------------------
export class SandboxLine extends BaseLine {
  readonly kind = "sandbox" as const;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private nodes: AudioNode[] = [];
  private voiceGain?: GainNode;
  private ringback?: OscillatorNode[];

  async connect() {
    this.set("connecting");
    await new Promise((r) => setTimeout(r, 300));
    this.set("ready");
  }

  async call() {
    if (this.state !== "ready" && this.state !== "ended") return;
    this.localStream = await microphone();
    this.set("dialing");
    this.timers.push(setTimeout(() => {
      this.set("ringing");
      this.startRingback();
    }, 900));
    this.timers.push(setTimeout(() => {
      this.stopRingback();
      this.remoteStream = this.synthVoice();
      this.set("in_call");
    }, 3200));
  }

  private startRingback() {
    const a = audioCtx();
    const g = a.createGain();
    g.gain.value = 0.05;
    g.connect(a.destination);
    const oscs = [425, 440].map((hz) => {
      const o = a.createOscillator();
      o.frequency.value = hz;
      o.connect(g);
      o.start();
      return o;
    });
    this.ringback = oscs;
    this.nodes.push(g);
  }

  private stopRingback() {
    this.ringback?.forEach((o) => { try { o.stop(); } catch {} });
    this.ringback = undefined;
  }

  /** A soft, speech-like murmur (formant-filtered noise with syllable rhythm). */
  private synthVoice(): MediaStream {
    const a = audioCtx();
    const dest = a.createMediaStreamDestination();
    const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const band = a.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 650;
    band.Q.value = 1.4;
    const env = a.createGain();
    env.gain.value = 0;
    const lfo = a.createOscillator();
    lfo.frequency.value = 3.2;
    const depth = a.createGain();
    depth.gain.value = 0.22;
    lfo.connect(depth).connect(env.gain);
    this.voiceGain = a.createGain();
    this.voiceGain.gain.value = 0.9;
    src.connect(band).connect(env).connect(this.voiceGain);
    this.voiceGain.connect(dest);
    this.voiceGain.connect(a.destination); // the agent hears the "voter"
    src.start();
    lfo.start();
    this.nodes.push(src, band, env, lfo, depth, this.voiceGain);
    return dest.stream;
  }

  async hangup() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.stopRingback();
    this.nodes.forEach((n) => { try { (n as AudioScheduledSourceNode).stop?.(); } catch {} try { n.disconnect(); } catch {} });
    this.nodes = [];
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.held = this.muted = false;
    this.set("ended");
  }

  setMuted(on: boolean) {
    this.muted = on;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !on));
    this.emit();
  }

  async setHeld(on: boolean) {
    this.held = on;
    if (this.voiceGain) this.voiceGain.gain.value = on ? 0 : 0.9;
    this.setMuted(on || this.muted);
    this.emit();
  }

  async dtmf(tone: string) {
    playDtmf(tone);
  }

  async dispose() {
    await this.hangup();
    this.set("offline");
  }
}

// ---- SIP (production) ---------------------------------------------------------------
export class SipLine extends BaseLine {
  readonly kind = "sip" as const;
  private user?: import("sip.js").Web.SimpleUser;
  private audio = typeof Audio !== "undefined" ? new Audio() : undefined;

  constructor(private cfg: SoftphoneConfig) {
    super();
    if (this.audio) this.audio.autoplay = true;
  }

  async connect() {
    this.set("connecting");
    try {
      const { Web } = await import("sip.js");
      this.user = new Web.SimpleUser(this.cfg.wss_url!, {
        aor: this.cfg.uri,
        media: { remote: { audio: this.audio } },
        userAgentOptions: {
          authorizationUsername: this.cfg.username,
          authorizationPassword: this.cfg.password,
          displayName: undefined,
          sessionDescriptionHandlerFactoryOptions: {
            peerConnectionConfiguration: { iceServers: this.cfg.stun.map((urls) => ({ urls })) },
          },
        },
        delegate: {
          onCallCreated: () => this.set("dialing"),
          onCallAnswered: () => {
            this.localStream = this.user?.localMediaStream;
            this.remoteStream = this.user?.remoteMediaStream;
            this.set("in_call");
          },
          onCallHangup: () => {
            this.held = this.muted = false;
            this.set("ended");
          },
          onServerDisconnect: (e) => this.set("error", e ? `Phone line disconnected: ${e.message}` : "Phone line disconnected"),
        },
      });
      await this.user.connect();
      await this.user.register();
      this.set("ready");
    } catch (e) {
      this.set("error", e instanceof Error ? e.message : "Couldn't connect the phone line");
    }
  }

  async call(number: string) {
    if (!this.user || !this.cfg.domain) return;
    const digits = number.replace(/[^\d+*#]/g, "");
    this.set("dialing");
    try {
      await this.user.call(`sip:${digits}@${this.cfg.domain}`);
      this.set(this.state === "dialing" ? "ringing" : this.state);
    } catch (e) {
      this.set("error", e instanceof Error ? e.message : "Call failed");
    }
  }

  async hangup() {
    try {
      await this.user?.hangup();
    } catch {}
    this.held = this.muted = false;
    this.set("ended");
  }

  setMuted(on: boolean) {
    this.muted = on;
    if (on) this.user?.mute();
    else this.user?.unmute();
    this.emit();
  }

  async setHeld(on: boolean) {
    this.held = on;
    if (on) await this.user?.hold();
    else await this.user?.unhold();
    this.emit();
  }

  async dtmf(tone: string) {
    playDtmf(tone);
    await this.user?.sendDTMF(tone);
  }

  async dispose() {
    try {
      await this.user?.hangup();
    } catch {}
    try {
      await this.user?.unregister();
      await this.user?.disconnect();
    } catch {}
    this.set("offline");
  }
}

// ---- recording ---------------------------------------------------------------------
/** Mixes both sides of the call into one track and records it (WebM/Opus). */
export class CallRecorder {
  private rec?: MediaRecorder;
  private chunks: Blob[] = [];
  private sources: AudioNode[] = [];
  startedAt = 0;
  mime = "audio/webm";

  start(streams: (MediaStream | undefined)[]) {
    const a = audioCtx();
    const dest = a.createMediaStreamDestination();
    for (const s of streams) {
      if (!s || !s.getAudioTracks().length) continue;
      const src = a.createMediaStreamSource(s);
      src.connect(dest);
      this.sources.push(src);
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(dest.stream, type ? { mimeType: type } : undefined);
    this.mime = (type ?? "audio/webm").split(";")[0];
    this.chunks = [];
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start(1000);
    this.startedAt = Date.now();
  }

  get active() {
    return this.rec?.state === "recording";
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.rec || this.rec.state === "inactive") return resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null);
      this.rec.onstop = () => {
        this.sources.forEach((s) => s.disconnect());
        resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null);
      };
      this.rec.stop();
    });
  }

  /** The voter declined: stop and throw the audio away. Nothing is uploaded. */
  async discard() {
    await this.stop();
    this.chunks = [];
  }
}

/** Live input level (0–1) for the VU meter. */
export function levelMeter(stream: MediaStream | undefined): (() => number) | null {
  if (!stream || !stream.getAudioTracks().length) return null;
  const a = audioCtx();
  const an = a.createAnalyser();
  an.fftSize = 256;
  a.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  return () => {
    an.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    return Math.min(peak / 64, 1);
  };
}
