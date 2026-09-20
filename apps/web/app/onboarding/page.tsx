"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

export default function OnboardingPage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en-IN");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Organisation name is required");
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgName: name.trim(), language }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-center">
      <div className="onboard-card">
        <h1>Set up your workspace</h1>
        <p>Enter your business name to get started. You can change this later.</p>
        <form onSubmit={submit}>
          <label>
            Business name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sunrise Realty"
              required
              autoFocus
            />
          </label>
          <label>
            Preferred language for AI calls
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en-IN">Indian English</option>
              <option value="te-IN">Telugu</option>
              <option value="hi-IN">Hindi</option>
              <option value="te-en">Tenglish (Telugu + English)</option>
            </select>
          </label>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "Setting up…" : "Create workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}
