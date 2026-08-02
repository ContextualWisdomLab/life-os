const navItems = ['Today', 'Goals', 'Projects', 'Tasks', 'Habits', 'Review'];

const cards = [
  { title: 'Daily priorities', value: '0 / 3', detail: 'Choose the three outcomes that matter today.' },
  { title: 'Active goals', value: '0', detail: 'Connect everyday work to a meaningful direction.' },
  { title: 'Habit adherence', value: '—', detail: 'History will appear after the first completion.' },
];

export default function HomePage() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">LifeOS</div>
        <nav>
          {navItems.map((item, index) => (
            <a className={index === 0 ? 'active' : undefined} href={index === 0 ? '/' : `/${item.toLowerCase()}`} key={item}>
              {item}
            </a>
          ))}
        </nav>
        <div className="auth-actions">
          <button type="button">Continue with Google</button>
          <button type="button" className="secondary">Continue with GitHub</button>
        </div>
      </aside>

      <section className="content">
        <header>
          <p className="eyebrow">Sunday · Personal workspace</p>
          <h1>Make today serve something larger.</h1>
          <p className="lede">Capture what matters, connect it to a goal, and choose the next concrete action.</p>
        </header>

        <section className="metrics" aria-label="Today summary">
          {cards.map((card) => (
            <article className="metric-card" key={card.title}>
              <p>{card.title}</p>
              <strong>{card.value}</strong>
              <span>{card.detail}</span>
            </article>
          ))}
        </section>

        <section className="today-panel">
          <div>
            <p className="eyebrow">Today</p>
            <h2>No tasks yet</h2>
            <p>Add a task, project, goal, or recurring habit. LifeOS will keep the relationship between them visible.</p>
          </div>
          <button type="button" className="primary">Add first item</button>
        </section>
      </section>
    </main>
  );
}
