import { getWallet, getTransactions } from "../../../../lib/api";
import TopupForm from "./topup-form";

export default async function WalletPage() {
  let wallet, transactions;
  try {
    [wallet, transactions] = await Promise.all([getWallet(), getTransactions()]);
  } catch {
    wallet = null; transactions = null;
  }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Wallet</h1>
        <span className="dash-page-sub">Prepaid INR balance for calls</span>
      </div>

      {wallet ? (
        <div className="wallet-summary">
          <div className="wallet-balance">
            <div className="wallet-balance-label">Available balance</div>
            <div className="wallet-balance-amount">
              ₹{wallet.availableRupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </div>
            <div className="wallet-balance-sub">
              Posted: ₹{(Number(wallet.balancePaise) / 100).toFixed(2)} · Reserved: ₹{(Number(wallet.reservedPaise) / 100).toFixed(2)}
            </div>
          </div>
        </div>
      ) : (
        <div className="dash-notice dash-notice--warn">Could not load wallet. Ensure the API is running.</div>
      )}

      <TopupForm />

      <section className="dash-section">
        <h2 className="dash-section-title">Transaction history</h2>
        {!transactions || transactions.length === 0 ? (
          <div className="dash-empty">
            <p>No transactions yet. Top-up or call charges will appear here.</p>
          </div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr><th>Type</th><th>Amount</th><th>Balance after</th><th>Description</th><th>Date</th></tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className={`badge ${t.direction === "credit" ? "badge--green" : "badge--red"}`}>
                        {t.reason}
                      </span>
                    </td>
                    <td className={t.direction === "credit" ? "amount-credit" : "amount-debit"}>
                      {t.direction === "credit" ? "+" : "-"}₹{(Number(t.amountPaise) / 100).toFixed(2)}
                    </td>
                    <td>₹{(Number(t.balanceAfterPaise) / 100).toFixed(2)}</td>
                    <td className="muted">{t.description}</td>
                    <td>{new Date(t.createdAt).toLocaleDateString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
