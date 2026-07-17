export function ProjectUnavailable({ title }: { title: string }) {
  return (
    <section className="empty-state" role="alert">
      <h1>{title} is unavailable</h1>
      <p>Check that its directory exists and is readable, then try again.</p>
    </section>
  );
}
