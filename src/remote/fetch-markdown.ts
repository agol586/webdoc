import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import { isPublicAddress } from "./public-address";

const MAX_URL_LENGTH = 2048;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ACCEPTED_CONTENT_TYPES = new Set([
  "application/markdown",
  "text/markdown",
  "text/plain",
  "text/x-markdown",
]);

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type RemoteHeaders = Record<string, string | string[] | undefined>;
export type RemoteResponse = {
  statusCode: number;
  headers: RemoteHeaders;
  body: AsyncIterable<Uint8Array>;
  close?: () => void;
};

export type RemoteRequest = {
  url: URL;
  address: string;
  family: 4 | 6;
  signal: AbortSignal;
};

export type RemoteFetchDependencies = {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  request: (input: RemoteRequest) => Promise<RemoteResponse>;
};

export class RemoteMarkdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteMarkdownError";
  }
}

function headerValue(headers: RemoteHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseRemoteUrl(rawUrl: string): URL {
  if (rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    throw new RemoteMarkdownError("The remote document URL is invalid.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteMarkdownError("The remote document URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new RemoteMarkdownError("Remote documents must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new RemoteMarkdownError("Remote document URLs cannot contain credentials.");
  }
  return url;
}

async function resolvePublicAddress(
  hostname: string,
  resolve: RemoteFetchDependencies["resolve"],
  signal: AbortSignal,
): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await abortable(resolve(hostname), signal);
  } catch {
    if (signal.aborted) throw new RemoteMarkdownError("The remote document request timed out.");
    throw new RemoteMarkdownError("The remote document host could not be resolved.");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => (family !== 4 && family !== 6) || !isPublicAddress(address))
  ) {
    throw new RemoteMarkdownError("The remote document host is not public.");
  }
  return addresses[0];
}

async function readBoundedBody(
  response: RemoteResponse,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = Number(headerValue(response.headers, "content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    response.close?.();
    throw new RemoteMarkdownError("The remote document is too large.");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const iterator = response.body[Symbol.asyncIterator]();
  try {
    for (;;) {
      const item = await abortable(iterator.next(), signal);
      if (item.done) break;
      const chunk = item.value;
      const buffer = Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        response.close?.();
        throw new RemoteMarkdownError("The remote document is too large.");
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof RemoteMarkdownError) throw error;
    if (signal.aborted) throw new RemoteMarkdownError("The remote document request timed out.");
    throw new RemoteMarkdownError("The remote document could not be read.");
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function acceptedContentType(headers: RemoteHeaders): boolean {
  const value = headerValue(headers, "content-type");
  if (!value) return false;
  return ACCEPTED_CONTENT_TYPES.has(value.split(";", 1)[0].trim().toLowerCase());
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
}

export function requestPinnedHttps(
  { url, address, family, signal }: RemoteRequest,
): Promise<RemoteResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "GET",
      agent: false,
      headers: {
        accept: "text/markdown, text/plain;q=0.9, application/markdown;q=0.9",
        "user-agent": "DocShare/0.1",
      },
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) {
          callback(null, [{ address, family }]);
        } else {
          callback(null, address, family);
        }
      },
      signal,
    }, (response) => {
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        close: () => response.destroy(),
      });
    });
    request.once("error", reject);
    request.end();
  });
}

const defaultDependencies: RemoteFetchDependencies = {
  resolve: defaultResolve,
  request: requestPinnedHttps,
};

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function fetchRemoteMarkdown(
  rawUrl: string,
  options: { maxBytes: number; timeoutMs?: number },
  dependencies: RemoteFetchDependencies = defaultDependencies,
): Promise<{ source: string; finalUrl: string }> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
    throw new RemoteMarkdownError("The remote document size limit is invalid.");
  }
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RemoteMarkdownError("The remote document timeout is invalid.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Remote document request timed out")),
    timeoutMs,
  );

  try {
    let url = parseRemoteUrl(rawUrl);
    for (let redirects = 0; ; redirects += 1) {
      const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
        ? url.hostname.slice(1, -1)
        : url.hostname;
      const { address, family } = await resolvePublicAddress(
        hostname,
        dependencies.resolve,
        controller.signal,
      );
      let response: RemoteResponse;
      try {
        response = await abortable(dependencies.request({
          url,
          address,
          family,
          signal: controller.signal,
        }), controller.signal);
      } catch {
        if (controller.signal.aborted) {
          throw new RemoteMarkdownError("The remote document request timed out.");
        }
        throw new RemoteMarkdownError("The remote document could not be retrieved.");
      }

      if (REDIRECT_STATUSES.has(response.statusCode)) {
        response.close?.();
        if (redirects >= MAX_REDIRECTS) {
          throw new RemoteMarkdownError("The remote document redirected too many times.");
        }
        const location = headerValue(response.headers, "location");
        if (!location) {
          throw new RemoteMarkdownError("The remote document returned an invalid redirect.");
        }
        try {
          url = parseRemoteUrl(new URL(location, url).href);
        } catch (error) {
          if (error instanceof RemoteMarkdownError) throw error;
          throw new RemoteMarkdownError("The remote document returned an invalid redirect.");
        }
        continue;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.close?.();
        throw new RemoteMarkdownError("The remote document returned an unsuccessful status.");
      }
      if (!acceptedContentType(response.headers)) {
        response.close?.();
        throw new RemoteMarkdownError("The remote document has an unsupported content type.");
      }
      return {
        source: await readBoundedBody(response, options.maxBytes, controller.signal),
        finalUrl: url.href,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}
