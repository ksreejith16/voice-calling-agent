"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Campaign = {
  id: string; name: string; status: string; goal: string; persona: string;
  language: string; voice: string | null; ratePaisePerMinute: string;
  billingQuantumSeconds: number; maxConnectedDurationSeconds: number;
  concurrencyLimit: number; pauseReason: string | null;
  scheduledAt: string | null; createdAt: string; updatedAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  running: "badge--green", draft: "badge--gray", paused: "badge--yellow",
  completed: "badge--blue", archived: "badge--gray", scheduled: "badge--purple",
};

const LANG_LABELS: Record<string, string> = {
  "en-IN": "Indian English", "te-IN": "Telugu", "hi-IN": "Hindi", "te-en": "Tenglish",
};

async function fetchCampaign(id: string): Promise<Campaign | null> {
  const res = await fetch(`/api/workspace/campaigns/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function patchCampaign(id: string, body: Partial<Campaign>) {
  const res = await fetch(`/api/workspace/campaigns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : "Update failed");
  return data as Campaign;
}

async function campaignAction(id: string, action: "launch" | "pause") {
  const res = await fetch(`/api/campaigns/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.message === "string" ? data.message : `${action} failed`);
  return data;
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [id, setId] = useState("");
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", goal: "", persona: "" });
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    params.then(({ id: resolvedId }) => {
      setId(resolvedId);
      fetchCampaign(resolvedId).then((c) => {
        setCampaign(c);
        if (c) {
          const initial = { name: c.name, goal: c.goal, persona: c.persona };
          setForm(initial);
          setSaved(JSON.stringify(initial));
        }
        setLoading(false);
      });
    });
  }, [params]);

  const dirty = saved !== JSON.stringify(form);
  const editable = campaign && ["draft", "paused"].includes(campaign.status);

  async function save() {
    if (!id) return;
    setBusy(true); setMessage("");
    try {
      const updated = await patchCampaign(id, form);
      setCampaign(updated);
      setSaved(JSON.stringify(form));
      setMessage("Saved.");
      router.refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "paused" | "draft" | "archived") {
    if (!id || !window.confirm(`Set campaign status to "${status}"?`)) return;
    setBusy(true); setMessage("");
    try {
      const updated = await patchCampaign(id, { status });
      setCampaign(updated);
      setMessage(`Campaign is now ${status}.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doAction(action: "launch" | "pause") {
    if (!id || !window.confirm(action === "launch" ? "Launch this campaign? Calls will begin immediately." : "Pause this campaign?")) return;
    setBusy(true); setMessage("");
    try {
      await campaignAction(id, action);
      const updated = await fetchCampaign(id);
      setCampaign(updated);
      setMessage(action === "launch" ? "Campaign launched. Calls are being dispatched." : "Campaign paused.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="dash-page"><p>Loading…</p></div>;
  if (!campaign) {
    return (
      <div className="dash-page">
        <div className="dash-page-header">
          <Link href="/dashboard/campaigns" className="dash-link">← Campaigns</Link>
        </div>
        <div className="dash-empty">
          <div className="dash-empty-icon">◉</div>
          <h2>Campaign not found</h2>
          <p>This campaign may have been archived or does not belong to your organisation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <Link href="/dashboard/campaigns" className="dash-link">← Campaigns</Link>
        <h1>{campaign.name}</h1>
        <span className={`badge ${STATUS_COLORS[campaign.status] ?? "badge--gray"}`}>{campaign.status}</span>
      </div>

      {campaign.pauseReason && (
        <div className="dash-notice">Pause reason: {campaign.pauseReason}</div>
      )}

      <section className="dash-card">
        <h2>Details</h2>
        <dl className="detail-grid">
          <dt>Language</dt><dd>{LANG_LABELS[campaign.language] ?? campaign.language}</dd>
          <dt>Voice</dt><dd>{campaign.voice ?? <span className="muted">default</span>}</dd>
          <dt>Rate</dt><dd>₹{(Number(campaign.ratePaisePerMinute) / 100).toFixed(2)} / min</dd>
          <dt>Billing quantum</dt><dd>{campaign.billingQuantumSeconds}s</dd>
          <dt>Max call duration</dt><dd>{Math.floor(campaign.maxConnectedDurationSeconds / 60)} min {campaign.maxConnectedDurationSeconds % 60}s</dd>
          <dt>Concurrency</dt><dd>{campaign.concurrencyLimit} simultaneous call{campaign.concurrencyLimit !== 1 ? "s" : ""}</dd>
          {campaign.scheduledAt && <><dt>Scheduled at</dt><dd>{new Date(campaign.scheduledAt).toLocaleString("en-IN")}</dd></>}
          <dt>Created</dt><dd>{new Date(campaign.createdAt).toLocaleString("en-IN")}</dd>
          <dt>Last updated</dt><dd>{new Date(campaign.updatedAt).toLocaleString("en-IN")}</dd>
        </dl>
      </section>

      <section className="dash-card">
        <h2>Edit campaign</h2>
        {!editable && (
          <p className="muted">
            Only draft or paused campaigns can be edited. Current status: <strong>{campaign.status}</strong>.
          </p>
        )}
        <fieldset disabled={!editable || busy} className="agent-form">
          <label className="form-group">
            Name
            <input className="form-input" maxLength={200} value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="form-group">
            Goal
            <textarea className="form-textarea" rows={3} maxLength={4000} value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })} />
          </label>
          <label className="form-group">
            Persona / tone
            <textarea className="form-textarea" rows={3} maxLength={4000} value={form.persona}
              onChange={(e) => setForm({ ...form, persona: e.target.value })} />
          </label>
          {editable && (
            <button className="dash-btn dash-btn--primary" disabled={!dirty || busy} onClick={() => void save()}>
              Save changes
            </button>
          )}
        </fieldset>
        {message && <p role="status">{message}</p>}
      </section>

      <section className="dash-card">
        <h2>Actions</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {["draft", "paused"].includes(campaign.status) && (
            <button className="dash-btn dash-btn--primary" disabled={busy} onClick={() => void doAction("launch")}>
              ▶ Launch campaign
            </button>
          )}
          {campaign.status === "running" && (
            <button className="dash-btn" disabled={busy} onClick={() => void doAction("pause")}>Pause</button>
          )}
          {campaign.status === "paused" && (
            <button className="dash-btn" disabled={busy} onClick={() => void setStatus("draft")}>Move to draft</button>
          )}
          {!["archived", "completed"].includes(campaign.status) && (
            <button className="dash-btn" disabled={busy} onClick={() => void setStatus("archived")}>Archive</button>
          )}
          <Link href={`/dashboard/leads?campaignId=${campaign.id}`} className="dash-btn">View leads</Link>
        </div>
        <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
          Launching requires funded wallet and leads in the campaign. Exotel telephony integration is pending — calls will be logged as &quot;telephony not configured&quot; until Exotel is set up.
        </p>
      </section>
    </div>
  );
}
