import styles from './offline.module.css';

/** Renders a credential-free fallback when a navigation cannot reach LifeOS. */
export default function OfflinePage() {
  return (
    <main className={styles.shell}>
      <section className={styles.card} aria-labelledby="offline-heading">
        <a className={styles.brand} href="/" aria-label="Retry LifeOS home">
          <span aria-hidden="true">L</span>
          <strong>LifeOS</strong>
        </a>
        <p className={styles.eyebrow}>Connection unavailable</p>
        <h1 id="offline-heading">LifeOS is offline.</h1>
        <p>
          Your browser-local Today draft remains on this device. Reconnect and
          retry to load the application; this offline page does not read or
          cache your planning data.
        </p>
        <a className={styles.retry} href="/">
          Try again
        </a>
      </section>
    </main>
  );
}
