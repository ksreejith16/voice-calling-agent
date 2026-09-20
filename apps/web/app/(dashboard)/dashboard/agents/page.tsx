import Link from "next/link";
import { getAgents } from "../../../../lib/api";

const LANG_LABELS: Record<string, string> = {
  "en-IN": "Indian English", "te-IN": "Telugu", "hi-IN": "Hindi", "te-en": "Tenglish",
};

export default async function AgentsPage() {
  let agents;
  try {
    agents = await getAgents();
  } catch {
    agents = null;
  }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Agents</h1>
        <span className="dash-page-sub">Reusable AI voice configurations</span>
        <Link href="/dashboard/agents/new" className="dash-btn dash-btn--primary">+ New agent</Link>
      </div>

      {!agents || agents.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">◎</div>
          <h2>No agents yet</h2>
          <p>
            Create your first voice agent. Give it a name, a language, a personality,
            and instructions for the conversation.
          </p>
          <Link href="/dashboard/agents/new" className="dash-btn dash-btn--primary">Create first agent</Link>
        </div>
      ) : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Language</th>
                <th>Voice</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td className="dash-table-primary">{a.name}</td>
                  <td>{LANG_LABELS[a.language] ?? a.language}</td>
                  <td>{a.voice ?? <span className="muted">default</span>}</td>
                  <td>{new Date(a.createdAt).toLocaleDateString("en-IN")}</td>
                  <td><Link href={`/dashboard/agents/${a.id}`} className="dash-link">Edit</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="dash-notice">
        Tip: After creating an agent, you can test it live at{" "}
        <a href="http://127.0.0.1:8765" target="_blank" rel="noopener">
          http://127.0.0.1:8765
        </a>{" "}
        with the voice browser harness.
      </div>
    </div>
  );
}
