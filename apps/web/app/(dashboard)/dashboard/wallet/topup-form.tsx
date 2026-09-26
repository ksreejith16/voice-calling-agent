"use client";
import { useState, useEffect, useRef } from "react";

declare global {
  interface Window {
    Razorpay?: new (opts: Record<string, unknown>) => { open(): void };
  }
}

export default function TopupForm() {
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    if (scriptLoaded.current) return;
    scriptLoaded.current = true;
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  async function handleTopup() {
    const paise = Math.round(parseFloat(amount) * 100);
    if (isNaN(paise) || paise < 10000) { setMessage("Minimum top-up is ₹100"); return; }
    if (paise > 10000000) { setMessage("Maximum top-up is ₹1,00,000 per order"); return; }

    setBusy(true); setMessage(""); setSuccess(false);
    try {
      const res = await fetch("/api/wallet/topup/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountPaise: paise }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Could not create order");

      if (!window.Razorpay) { throw new Error("Razorpay checkout did not load. Check your connection."); }

      const razorpay = new window.Razorpay({
        key: data.keyId,
        amount: paise,
        currency: "INR",
        name: "India Voice Platform",
        description: "Wallet top-up",
        order_id: data.orderId,
        prefill: {},
        theme: { color: "#3449b5" },
        handler: () => {
          setSuccess(true);
          setMessage("Payment successful! Your wallet balance will update within a few seconds.");
        },
        modal: { ondismiss: () => { setBusy(false); setMessage("Payment cancelled."); } },
      });
      razorpay.open();
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="dash-card">
      <h2>Add funds</h2>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        Funds are credited to your wallet immediately after Razorpay confirms payment.
        Minimum ₹100. Secure payment via Razorpay.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="form-group" style={{ marginBottom: 0, flex: "0 0 auto" }}>
          Amount (₹)
          <input className="form-input" type="number" min="100" max="100000" step="100"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            style={{ width: 140 }} disabled={busy} />
        </label>
        {[100, 500, 1000, 5000].map((amt) => (
          <button key={amt} className="dash-btn" style={{ alignSelf: "flex-end" }}
            disabled={busy} onClick={() => setAmount(String(amt))}>
            ₹{amt.toLocaleString("en-IN")}
          </button>
        ))}
        <button className="dash-btn dash-btn--primary" style={{ alignSelf: "flex-end" }}
          disabled={busy} onClick={() => void handleTopup()}>
          {busy ? "Processing…" : "Pay with Razorpay"}
        </button>
      </div>
      {message && (
        <p role="status" style={{ marginTop: 12, fontSize: 13, color: success ? "#2e7d4e" : "#b82020" }}>
          {message}
        </p>
      )}
    </section>
  );
}
