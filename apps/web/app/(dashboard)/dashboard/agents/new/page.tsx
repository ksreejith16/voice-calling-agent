"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

const SPEAKERS = ["shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "simran"];

export default function NewAgentPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", description: "", language: "en-IN",
    voice: "shubh", instructions: "", openingMessage: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Agent name is required");
    setSaving(true); setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/dashboard/agents");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>New agent</h1>
        <span className="dash-page-sub">Configure a reusable AI voice agent</span>
      </div>
      <form onSubmit={submit} className="agent-form">
        <div className="form-group">
          <label className="form-label">Agent name *</label>
          <input className="form-input" value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Sales Agent - Real Estate" required />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <input className="form-input" value={form.description} onChange={(e) => set("description", e.target.value)}
            placeholder="What is this agent for?" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Language</label>
            <select className="form-input" value={form.language} onChange={(e) => set("language", e.target.value)}>
              <option value="en-IN">Indian English</option>
              <option value="te-IN">Telugu</option>
              <option value="hi-IN">Hindi</option>
              <option value="te-en">Tenglish (Telugu + English)</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Voice</label>
            <select className="form-input" value={form.voice} onChange={(e) => set("voice", e.target.value)}>
              {SPEAKERS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Opening message</label>
          <input className="form-input" value={form.openingMessage} onChange={(e) => set("openingMessage", e.target.value)}
            placeholder="Hello! I'm calling from Sunrise Realty about the property you enquired about..." />
          <span className="form-hint">First thing the AI says when the call connects.</span>
        </div>
        <div className="form-group">
          <label className="form-label">Instructions</label>
          <textarea className="form-textarea" rows={6} value={form.instructions} onChange={(e) => set("instructions", e.target.value)}
            placeholder={`You are a friendly real estate sales agent calling on behalf of Sunrise Realty.\nYour goal is to understand the lead's property requirements and schedule a site visit.\nAsk: How many bedrooms do they need? What's their budget? When can they visit?\nBe polite and speak in the selected language.`} />
          <span className="form-hint">Instructions for the AI — what to say, what to collect, how to behave.</span>
        </div>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button type="button" className="dash-btn dash-btn--secondary" onClick={() => router.back()}>Cancel</button>
          <button type="submit" className="dash-btn dash-btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Create agent"}
          </button>
        </div>
      </form>
    </div>
  );
}
