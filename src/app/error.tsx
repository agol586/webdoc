"use client";

export default function ErrorView({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="standalone-state" role="alert">
          <h1>This document could not be displayed</h1>
          <p>An unexpected error occurred. No document content was exposed.</p>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
