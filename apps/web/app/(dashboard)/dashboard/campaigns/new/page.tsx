"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

export default function NewCampaignPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", goal: "", persona: "", language: "en-IN",
    ratePaisePerMinute: "100", maxConnectedDurationSeconds: "300", billingQuantumSeconds: "60",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string) { setForm((f) => ({ ...f, [field]: value })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Campaign name is required");
    const rate = parseInt(form.ratePaisePerMinute, 10);
    if (!rate || rate < 1) return setError("Rate must be a positive number");
    setSaving(true); setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name.trim(), goal: form.goal.trim(), persona: form.persona.trim(),
          language: form.language, ratePaisePerMinute: rate,
          maxConnectedDurationSeconds: parseInt(form.maxConnectedDurationSeconds, 10),
          billingQuantumSeconds: parseInt(form.billingQuantumSeconds, 10) as 30 | 60,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/dashboard/campaigns");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const rateRupees = (parseInt(form.ratePaisePerMinute || "0", 10) / 100).toFixed(2);

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>New campaign</h1>
        <span className="dash-page-sub">Set up an outbound calling campaign</span>
      </div>
      <form onSubmit={submit} className="agent-form">
        <div className="form-group">
          <label className="form-label">Campaign name *</label>
          <input className="form-input" value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Q4 Real Estate Outreach" required />
        </div>
        <div className="form-group">
          <label className="form-label">Goal</label>
          <textarea className="form-textarea" rows={3} value={form.goal} onChange={(e) => set("goal", e.target.value)}
            placeholder="Schedule a site visit for interested leads." />
          <span className="form-hint">What should this campaign accomplish?</span>
        </div>
        <div className="form-group">
          <label className="form-label">Agent persona / personality</label>
          <textarea className="form-textarea" rows={3} value={form.persona} onChange={(e) => set("persona", e.target.value)}
            placeholder="Friendly, professional. Speaks clearly. Asks one question at a time." />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Language</label>
            <select className="form-input" value={form.language} onChange={(e) => set("language", e.target.value)}>
              <option value="en-IN">Indian English</option>
              <option value="te-IN">Telugu</option>
              <option value="hi-IN">Hindi</option>
              <option value="te-en">Tenglish</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Billing quantum</label>
            <select className="form-input" value={form.billingQuantumSeconds} onChange={(e) => set("billingQuantumSeconds", e.target.value)}>
              <option value="60">60 seconds</option>
              <option value="30">30 seconds</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Rate (paise/minute)</label>
            <input className="form-input" type="number" min="1" value={form.ratePaisePerMinute}
              onChange={(e) => set("ratePaisePerMinute", e.target.value)} />
            <span className="form-hint">₹{rateRupees}/min — 100 paise = ₹1</span>
          </div>
          <div className="form-group">
            <label className="form-label">Max call duration (seconds)</label>
            <input className="form-input" type="number" min="30" max="3600" value={form.maxConnectedDurationSeconds}
              onChange={(e) => set("maxConnectedDurationSeconds", e.target.value)} />
            <span className="form-hint">Calls will be cut off after this long</span>
          </div>
        </div>
        <div className="dash-notice">
          After creating the campaign, add leads and configure the calling schedule. Calls will not be made until you launch the campaign and telephony (Exotel) is configured.
        </div>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button type="button" className="dash-btn dash-btn--secondary" onClick={() => router.back()}>Cancel</button>
          <button type="submit" className="dash-btn dash-btn--primary" disabled={saving}>
            {saving ? "Creating…" : "Create campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
