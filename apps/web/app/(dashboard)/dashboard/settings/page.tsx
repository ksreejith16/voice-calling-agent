import { getMe } from "../../../../lib/api";

const LANG_LABELS: Record<string, string> = {
  "en-IN": "Indian English", "te-IN": "Telugu", "hi-IN": "Hindi", "te-en": "Tenglish",
};

export default async function SettingsPage() {
  let me;
  try { me = await getMe(); } catch { me = null; }

  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <h1>Settings</h1>
        <span className="dash-page-sub">Organisation configuration</span>
      </div>

      {me?.organization ? (
        <>
          <section className="dash-section">
            <h2 className="dash-section-title">Organisation</h2>
            <div className="settings-grid">
              <div className="settings-row">
                <span className="settings-key">Name</span>
                <span className="settings-val">{me.organization.name}</span>
              </div>
              <div className="settings-row">
                <span className="settings-key">Slug</span>
                <span className="settings-val">{me.organization.slug}</span>
              </div>
              <div className="settings-row">
                <span className="settings-key">Default language</span>
                <span className="settings-val">{LANG_LABELS[me.organization.defaults.language] ?? me.organization.defaults.language}</span>
              </div>
              <div className="settings-row">
                <span className="settings-key">Timezone</span>
                <span className="settings-val">{me.organization.defaults.timezone}</span>
              </div>
              <div className="settings-row">
                <span className="settings-key">Status</span>
                <span className="settings-val">{me.organization.status}</span>
              </div>
              <div className="settings-row">
                <span className="settings-key">Organisation ID</span>
                <span className="settings-val muted">{me.organization.id}</span>
              </div>
            </div>
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Your account</h2>
            <div className="settings-grid">
              <div className="settings-row">
                <span className="settings-key">Role</span>
                <span className="settings-val">{me.role}</span>
              </div>
              <div className="settings-row">
                <span className="settings-key">User ID</span>
                <span className="settings-val muted">{me.userId}</span>
              </div>
            </div>
          </section>

          <div className="dash-notice">
            Team member management, role changes, and organisation editing will be added in a future update.
          </div>
        </>
      ) : (
        <div className="dash-notice dash-notice--warn">Could not load settings. Ensure the API is running.</div>
      )}
    </div>
  );
}
