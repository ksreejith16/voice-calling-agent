"use client";
import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Row = { phone: string; name?: string; externalReference?: string; _rowNum: number };
type ImportError = { row: number; field: string; message: string };
type ImportResult = { total: number; imported: number; skipped: number; errors: ImportError[] };

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

function parseCSV(text: string): { rows: Row[]; parseErrors: string[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], parseErrors: ["File is empty"] };

  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const phoneIdx = header.findIndex((h) => ["phone", "phone_number", "mobile", "mobile_number", "number"].includes(h));
  const nameIdx = header.findIndex((h) => ["name", "full_name", "contact_name", "lead_name"].includes(h));
  const refIdx = header.findIndex((h) => ["ref", "reference", "external_reference", "external_ref", "id"].includes(h));

  if (phoneIdx === -1) {
    return { rows: [], parseErrors: ['Column named "phone", "mobile", or "number" is required in the header row.'] };
  }

  const rows: Row[] = [];
  const parseErrors: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const phone = cells[phoneIdx]?.trim() ?? "";
    if (!phone) continue;
    rows.push({
      _rowNum: i + 1,
      phone,
      name: nameIdx >= 0 ? cells[nameIdx]?.trim() || undefined : undefined,
      externalReference: refIdx >= 0 ? cells[refIdx]?.trim() || undefined : undefined,
    });
    if (rows.length >= 5000) {
      parseErrors.push("Only the first 5,000 rows will be imported.");
      break;
    }
  }

  return { rows, parseErrors };
}

export default function ImportLeadsPage() {
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [campaignId, setCampaignId] = useState(searchParams.get("campaignId") ?? "");

  useEffect(() => {
    const id = searchParams.get("campaignId");
    if (id) setCampaignId(id);
  }, [searchParams]);
  const [preview, setPreview] = useState<Row[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null); setMessage("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { rows, parseErrors: errs } = parseCSV(text);
      setPreview(rows);
      setParseErrors(errs);
    };
    reader.readAsText(file);
  }

  async function doImport() {
    if (!preview || preview.length === 0 || !campaignId.trim()) return;
    setBusy(true); setMessage("");
    try {
      const resp = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaignId.trim(),
          rows: preview.map(({ phone, name, externalReference }) => ({ phone, name, externalReference })),
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message ?? "Import failed");
      setResult(data as ImportResult);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <Link href="/dashboard/leads" className="dash-link">← Leads</Link>
        <h1>Import leads from CSV</h1>
      </div>

      <section className="dash-card">
        <h2>CSV format</h2>
        <p style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
          First row must be a header. Required column: <code>phone</code> (E.164 format, e.g. <code>+919876543210</code>).
          Optional columns: <code>name</code>, <code>reference</code>. Maximum 5,000 rows per import.
        </p>
        <pre style={{ background: "#f5f7fa", padding: "10px 14px", borderRadius: 6, fontSize: 12, marginTop: 10 }}>
          {`phone,name,reference\n+919876543210,Ravi Kumar,REF001\n+918765432109,Priya Sharma,REF002`}
        </pre>
      </section>

      <section className="dash-card">
        <h2>Upload</h2>
        <label className="form-group">
          Campaign ID (paste from the campaigns page URL)
          <input className="form-input" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={campaignId} onChange={(e) => setCampaignId(e.target.value)} />
        </label>
        <label className="form-group" style={{ marginTop: 12 }}>
          CSV file
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile}
            style={{ marginTop: 6, fontSize: 13 }} />
        </label>

        {parseErrors.length > 0 && (
          <ul style={{ color: "#b82020", fontSize: 12, marginTop: 8 }}>
            {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}

        {preview && preview.length > 0 && (
          <>
            <p style={{ fontSize: 13, marginTop: 16 }}>
              <strong>{preview.length}</strong> rows ready to import.
              Preview (first 5):
            </p>
            <div className="dash-table-wrap" style={{ marginTop: 8 }}>
              <table className="dash-table">
                <thead><tr><th>Row</th><th>Phone</th><th>Name</th><th>Valid?</th></tr></thead>
                <tbody>
                  {preview.slice(0, 5).map((r) => (
                    <tr key={r._rowNum}>
                      <td className="muted">{r._rowNum}</td>
                      <td>{r.phone}</td>
                      <td>{r.name ?? <span className="muted">—</span>}</td>
                      <td>{E164_RE.test(r.phone)
                        ? <span className="badge badge--green">OK</span>
                        : <span className="badge badge--red">Bad phone</span>}
                      </td>
                    </tr>
                  ))}
                  {preview.length > 5 && <tr><td colSpan={4} className="muted">… {preview.length - 5} more rows</td></tr>}
                </tbody>
              </table>
            </div>
            <button className="dash-btn dash-btn--primary" style={{ marginTop: 16 }}
              disabled={busy || !campaignId.trim()} onClick={() => void doImport()}>
              {busy ? "Importing…" : `Import ${preview.length} leads`}
            </button>
          </>
        )}
        {message && <p role="alert" style={{ color: "#b82020", marginTop: 12 }}>{message}</p>}
      </section>

      {result && (
        <section className="dash-card">
          <h2>Import complete</h2>
          <dl className="detail-grid">
            <dt>Total rows</dt><dd>{result.total}</dd>
            <dt>Imported</dt><dd style={{ color: "#2e7d4e", fontWeight: 600 }}>{result.imported}</dd>
            <dt>Skipped (duplicates)</dt><dd>{result.skipped}</dd>
            <dt>Errors</dt><dd>{result.errors.length}</dd>
          </dl>
          {result.errors.length > 0 && (
            <>
              <p style={{ marginTop: 12, fontSize: 13, fontWeight: 600 }}>Row errors:</p>
              <ul style={{ fontSize: 12, color: "#b82020" }}>
                {result.errors.map((e, i) => <li key={i}>Row {e.row} — {e.field}: {e.message}</li>)}
              </ul>
            </>
          )}
          <Link
            href={campaignId ? `/dashboard/leads?campaignId=${encodeURIComponent(campaignId)}` : "/dashboard/leads"}
            className="dash-btn dash-btn--primary"
            style={{ display: "inline-block", marginTop: 16 }}
          >
            View leads →
          </Link>
        </section>
      )}
    </div>
  );
}
