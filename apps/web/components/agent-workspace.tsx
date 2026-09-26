"use client";
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Room, RoomEvent, Track } from 'livekit-client';

type Agent = { id: string; name: string; description: string; language: string; voice: string | null; instructions: string; openingMessage: string; status: string };
type History = { id: string; status: string; errorCode: string | null; createdAt: string; expiresAt: string };
async function request(path: string, method = 'GET', body?: unknown) {
  const serializedBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch('/api/workspace/' + path, {
    method,
    headers: serializedBody ? { 'Content-Type': 'application/json' } : {},
    ...(serializedBody ? { body: serializedBody } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Request failed');
  return data;
}
export default function AgentWorkspace({ agent, role }: { agent: Agent; role: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: agent.name, description: agent.description, language: agent.language, voice: agent.voice ?? 'shubh', instructions: agent.instructions, openingMessage: agent.openingMessage });
  const [saved, setSaved] = useState(JSON.stringify(form));
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Not connected');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<Record<string, { who: string; text: string }>>({});
  const [history, setHistory] = useState<History[]>([]);
  const current = useRef<{ room: Room; id?: string; generation: number } | null>(null);
  const generation = useRef(0);
  const audio = useRef<HTMLDivElement>(null);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const canEdit = role !== 'viewer';
  const dirty = saved !== JSON.stringify(form);
  async function refreshHistory() { try { const rows = await request('voice-tests/agent/' + agent.id); if (mounted.current) setHistory(rows); } catch { /* active session errors displayed separately */ } }
  async function stop(reason = 'Session ended') {
    ++generation.current;
    const owned = current.current; current.current = null;
    if (polling.current) clearInterval(polling.current); polling.current = null;
    if (owned) { owned.room.removeAllListeners(); try { await owned.room.disconnect(); } catch { /* local cleanup and server deletion still run */ } }
    audio.current?.replaceChildren();
    if (mounted.current) { setActive(false); setBusy(false); setStatus(reason); }
    if (owned?.id) {
      try { await request('voice-tests/' + owned.id, 'DELETE'); }
      catch { if (mounted.current) setMessage('Microphone stopped. Server cleanup is pending; the session has a ten-minute maximum.'); }
    }
    if (mounted.current) void refreshHistory();
  }
  useEffect(() => {
    mounted.current = true; void refreshHistory();
    return () => { mounted.current = false; void stop(); };
    // This component is keyed by the immutable agent ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function save() {
    setBusy(true); setMessage('');
    try { await request('agents/' + agent.id, 'PATCH', form); setSaved(JSON.stringify(form)); setMessage('Agent saved.'); router.refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function start() {
    if (current.current || busy) return;
    setBusy(true); setMessage(''); setTranscript({}); setStatus('Starting session');
    const attempt = ++generation.current;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    const owned = { room, generation: attempt, id: undefined as string | undefined }; current.current = owned;
    const valid = () => current.current === owned && generation.current === attempt && mounted.current;
    try {
      // Called during the button gesture, before any network await.
      void room.startAudio().catch(() => undefined);
      room.on(RoomEvent.TrackSubscribed, track => {
        if (!valid() || track.kind !== Track.Kind.Audio) return;
        const element = track.attach(); element.autoplay = true; audio.current?.appendChild(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, track => track.detach().forEach(el => el.remove()));
      room.on(RoomEvent.Reconnecting, () => { if (valid()) setStatus('Reconnecting'); });
      room.on(RoomEvent.Reconnected, () => { if (valid()) setStatus('Connected'); });
      room.on(RoomEvent.Disconnected, () => { if (valid()) void stop('Disconnected'); });
      room.registerTextStreamHandler('lk.transcription', async (reader, participant) => {
        const key = participant.identity + ':' + (reader.info.attributes?.['lk.segment_id'] || reader.info.id);
        let text = '';
        for await (const chunk of reader) {
          text += chunk;
          if (!valid() || text.length > 20000) break;
          setTranscript(previous => {
            const entries = Object.entries(previous).slice(-199);
            return { ...Object.fromEntries(entries), [key]: { who: participant.identity === room.localParticipant.identity ? 'You' : 'Agent', text } };
          });
        }
      });
      const result = await request('voice-tests/' + agent.id, 'POST'); owned.id = result.id;
      if (!valid()) { await request('voice-tests/' + result.id, 'DELETE'); return; }
      await room.connect(result.url, result.token);
      if (!valid()) { await room.disconnect(); return; }
      await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (!valid()) { await room.disconnect(); return; }
      setActive(true); setMuted(false); setBusy(false); setStatus('Waiting for voice worker');
      let checking = false;
      let failures = 0;
      polling.current = setInterval(async () => {
        if (!valid() || checking) return; checking = true;
        try {
          const state = await request('voice-tests/' + result.id); failures = 0;
          if (!valid()) return;
          if (['failed','ended','expired'].includes(state.status)) { setMessage(state.errorCode === 'worker_unavailable' ? 'The voice worker did not become ready. Start it and try again.' : state.errorCode ? 'The voice provider failed. Check worker logs and retry.' : 'Session finished.'); await stop(state.status); }
          else setStatus(state.status === 'active' ? 'Ready ? speak now' : 'Waiting for voice worker');
        } catch { if (valid()) { setMessage('Cannot reach the session API.'); if (++failures >= 3) await stop('Connection lost'); } }
        finally { checking = false; }
      }, 2500);
    } catch (e) { if (valid()) { setMessage((e as Error).message); await stop('Could not start'); } }
  }
  return <div className="dash-page">
    <h1>{agent.name}</h1>
    <p>Edit this agent, save, then test the saved configuration in your browser.</p>
    <fieldset disabled={!canEdit || busy || active || agent.status !== 'active'} className="agent-form">
      {(['name','description','openingMessage'] as const).map(key => <label key={key} className="form-group">{key === 'openingMessage' ? 'Opening message' : key}<input className="form-input" maxLength={key === 'name' ? 200 : key === 'openingMessage' ? 1000 : 2000} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}
      <label className="form-group">Language<select className="form-input" value={form.language} onChange={e => setForm({ ...form, language: e.target.value })}>{['en-IN','te-IN','hi-IN','te-en'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="form-group">Voice<select className="form-input" value={form.voice} onChange={e => setForm({ ...form, voice: e.target.value })}>{['shubh','aditya','ritu','priya','neha','rahul','pooja','simran'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="form-group">Instructions<textarea className="form-textarea" rows={6} maxLength={12000} value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} /></label>
      <button className="dash-btn dash-btn--primary" onClick={() => void save()}>Save changes</button>{' '}
      <button className="dash-btn" onClick={async () => { if (!window.confirm('Archive this agent?')) return; try { await request('agents/' + agent.id, 'DELETE'); router.push('/dashboard/agents'); router.refresh(); } catch (e) { setMessage((e as Error).message); } }}>Archive agent</button>
    </fieldset>
    <section aria-label="Browser voice test" className="dash-card">
      <h2>Test this agent</h2>
      <p>Browser test only ? maximum 10 minutes ? no wallet debit. Provider usage may incur costs. Transcripts stay on this page; session outcomes are saved.</p>
      {dirty && <p>Save your changes before starting a test.</p>}
      <button className="dash-btn dash-btn--primary" disabled={!canEdit || busy || active || dirty || agent.status !== 'active'} onClick={() => void start()}>Start voice test</button>{' '}
      <button className="dash-btn" disabled={!active && !current.current} onClick={() => void stop()}>End test</button>{' '}
      <button className="dash-btn" disabled={!active} onClick={async () => { try { await current.current?.room.localParticipant.setMicrophoneEnabled(muted); setMuted(!muted); } catch { setMessage('Microphone could not be changed'); } }}>{muted ? 'Unmute' : 'Mute'}</button>{' '}
      <button className="dash-btn" disabled={!active} onClick={() => { void current.current?.room.startAudio().catch(() => setMessage('Allow audio playback in your browser')); }}>Enable audio</button>
      <p role="status">{status}</p><p role="alert">{message}</p>
      <div ref={audio} />
      <h3>Conversation</h3><ol aria-live="polite">{Object.entries(transcript).map(([id, item]) => <li key={id}><strong>{item.who}:</strong> {item.text}</li>)}</ol>
      <p>Connection and transcript events do not measure when you hear a reply. The caller-perceived p95 target remains unmeasured.</p>
    </section>
    <section><h2>Recent tests</h2><button className="dash-btn" onClick={() => void refreshHistory()}>Refresh history</button><ul>{history.map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString()} ? {new Date(item.expiresAt).getTime() < Date.now() && ['starting','active'].includes(item.status) ? 'Expired (pending reconciliation)' : item.status}{item.errorCode ? `: ${item.errorCode}` : ''}</li>)}</ul></section>
  </div>;
}
