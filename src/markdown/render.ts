import rehypeShiki from "@shikijs/rehype";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { rewriteRelativeUrls, rewriteRemoteUrls } from "./links";

export interface RenderInput {
  projectId: string;
  documentPath: string;
  source: string;
  remoteBaseUrl?: string;
}

type AstNode = {
  type?: string;
  depth?: number;
  value?: string;
  alt?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: AstNode[];
};

function textContent(node: AstNode): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "image") return node.alt ?? "";
  return (node.children ?? []).map(textContent).join("");
}

function captureFirstHeading() {
  return (tree: AstNode, file: { data: Record<string, unknown> }): void => {
    const heading = tree.children?.find(
      (node) => node.type === "heading",
    );
    if (heading) file.data.title = textContent(heading);
  };
}

function isMermaidLanguage(language: unknown): boolean {
  return typeof language === "string" && language.toLowerCase() === "mermaid";
}

function markMermaidBlocks() {
  return (tree: AstNode): void => {
    const walk = (node: AstNode): void => {
      const code = node.tagName === "pre" ? node.children?.[0] : undefined;
      const classes = code?.properties?.className;
      if (
        code?.tagName === "code" &&
        Array.isArray(classes) &&
        classes.some(
          (className) =>
            typeof className === "string" &&
            className.startsWith("language-") &&
            isMermaidLanguage(className.slice("language-".length)),
        )
      ) {
        const source = textContent(code).replace(/\n$/, "");
        node.properties = { className: ["mermaid"], dataMermaidSource: source };
        node.children = [];
        return;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

function hasHighlightableCode(tree: AstNode): boolean {
  if (tree.type === "code") {
    const language = (tree as AstNode & { lang?: string }).lang;
    return !isMermaidLanguage(language);
  }
  return (tree.children ?? []).some(hasHighlightableCode);
}

export async function renderMarkdown(
  input: RenderInput,
): Promise<{ html: string; title?: string }> {
  const createMarkdownProcessor = () => unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(captureFirstHeading);
  const markdownProcessor = input.remoteBaseUrl
    ? createMarkdownProcessor().use(rewriteRemoteUrls, { baseUrl: input.remoteBaseUrl })
    : createMarkdownProcessor().use(rewriteRelativeUrls, {
        projectId: input.projectId,
        documentPath: input.documentPath,
      });
  const htmlProcessor = markdownProcessor
    .use(remarkRehype)
    .use(markMermaidBlocks)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings);

  const parsed = unified().use(remarkParse).parse(input.source) as AstNode;
  const finalProcessor = hasHighlightableCode(parsed)
    ? htmlProcessor.use(rehypeShiki, { theme: "github-dark" })
    : htmlProcessor;
  const file = await finalProcessor.use(rehypeStringify).process(input.source);

  const title = typeof file.data.title === "string" ? file.data.title : undefined;
  return { html: String(file), title };
}
