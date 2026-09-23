export default function SettingsPage() {
  return (
    <div className="today-shell">
      <aside className="today-sidebar" aria-label="LifeOS navigation">
        <a className="today-brand" href="/">
          <span aria-hidden="true">L</span>
          <strong>LifeOS</strong>
        </a>
        <nav aria-label="Primary navigation">
          <a href="/">Today</a>
          <a className="active" href="/settings" aria-current="page">
            Settings
          </a>
        </nav>
        <p className="local-note">
          <strong>Owner-backed settings</strong>
          <span>
            Account changes stay unavailable until authenticated service owners
            can provide durable evidence.
          </span>
        </p>
      </aside>

      <main className="today-main" id="settings">
        <header className="today-header">
          <div>
            <p className="eyebrow">Account</p>
            <h1>Settings</h1>
            <p className="lede">
              This surface composes settings owned by LifeOS services. It does
              not invent saved account state when an owner contract is not
              available.
            </p>
          </div>
        </header>

        <section aria-labelledby="settings-availability-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current availability</p>
              <h2 id="settings-availability-heading">
                No account controls yet
              </h2>
            </div>
          </div>
          <div className="empty-state" role="status">
            <span aria-hidden="true">—</span>
            <div>
              <h3>Authenticated settings owners are not connected.</h3>
              <p>
                Profile, account language, integrations, notifications, and
                privacy controls will appear only after their owning services
                expose accepted contracts. Your browser-local Today data is not
                uploaded from this page.
              </p>
              <p>
                Return to <a href="/">Today</a> to continue working with the
                currently available local workspace.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
