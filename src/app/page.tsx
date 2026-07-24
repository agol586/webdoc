import { redirect } from "next/navigation";

import { DocumentView } from "../components/document-view";
import { RemoteLinkForm } from "../components/remote-link-form";
import { MarkdownUrlError } from "../markdown/links";
import { renderMarkdown } from "../markdown/render";
import { fetchRemoteMarkdown, RemoteMarkdownError } from "../remote/fetch-markdown";
import { getServerContext } from "../server/context";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ link?: string | string[] }>;
};

function encodedRoute(projectId: string, path?: string | null): string {
  const root = `/p/${encodeURIComponent(projectId)}`;
  return path ? `${root}/${path.split("/").map(encodeURIComponent).join("/")}` : root;
}

function RemoteDocumentError({ message }: { message: string }) {
  return (
    <main className="standalone-state" role="alert">
      <RemoteLinkForm />
      <h1>Remote document could not be displayed</h1>
      <p>{message}</p>
    </main>
  );
}

export default async function Home({ searchParams }: PageProps) {
  const { link } = await searchParams;
  const { config, repository } = await getServerContext();

  if (Array.isArray(link)) {
    return <RemoteDocumentError message="Provide a single link parameter." />;
  }
  if (link !== undefined) {
    let remote: Awaited<ReturnType<typeof fetchRemoteMarkdown>>;
    try {
      remote = await fetchRemoteMarkdown(link, {
        maxBytes: config.limits.markdownBytes,
      });
    } catch (error) {
      if (error instanceof RemoteMarkdownError) {
        return <RemoteDocumentError message={error.message} />;
      }
      throw error;
    }

    let content: Awaited<ReturnType<typeof renderMarkdown>>;
    try {
      content = await renderMarkdown({
        projectId: "remote",
        documentPath: remote.finalUrl,
        remoteBaseUrl: remote.finalUrl,
        source: remote.source,
      });
    } catch (error) {
      if (error instanceof MarkdownUrlError) {
        return <RemoteDocumentError message="The remote document content is unsafe or invalid." />;
      }
      throw error;
    }
    const sourceHost = new URL(remote.finalUrl).hostname;
    return (
      <main className="content-pane remote-document">
        <RemoteLinkForm defaultValue={remote.finalUrl} />
        <p className="remote-source">
          Remote source:{" "}
          <a href={remote.finalUrl} target="_blank" rel="noopener noreferrer">{sourceHost}</a>
        </p>
        <DocumentView {...content} path={remote.finalUrl} />
      </main>
    );
  }

  const project = config.projects[0];
  if (!(await repository.isAvailable(project))) redirect(encodedRoute(project.id));
  const tree = await repository.getTree(project);
  const homepage = await repository.chooseHomepage(project, tree);
  redirect(encodedRoute(project.id, homepage));
}
