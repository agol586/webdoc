export function RemoteLinkForm({ defaultValue }: { defaultValue?: string }) {
  return (
    <form className="remote-link-form" action="/" method="get">
      <label>
        <span>Remote Markdown URL</span>
        <input
          type="url"
          name="link"
          defaultValue={defaultValue}
          placeholder="https://example.com/README.md"
          autoComplete="url"
          inputMode="url"
          required
        />
      </label>
      <button type="submit">Open</button>
    </form>
  );
}
