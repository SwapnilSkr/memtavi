import { request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export interface FetchRequestInit extends RequestOptions {
  lookup: LookupFunction;
  servername?: string;
  autoSelectFamily: false;
  body?: string;
}

export type FetchImpl = (input: string, init: FetchRequestInit) => Promise<Response>;

type Request = (
  input: string,
  init: Parameters<FetchImpl>[1],
  onResponse: Parameters<typeof httpRequest>[2],
) => ReturnType<typeof httpRequest>;

export function createFetchTransport(requestImpl?: Request): FetchImpl {
  return (input, init) =>
    new Promise((resolve, reject) => {
      const { body, ...options } = init;
      const request =
        requestImpl ?? (new URL(input).protocol === "https:" ? httpsRequest : httpRequest);
      const outgoing = request(input, options, (incoming) => {
        try {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            const name = incoming.rawHeaders[index];
            const value = incoming.rawHeaders[index + 1];
            if (name !== undefined && value !== undefined) headers.append(name, value);
          }

          const status = incoming.statusCode ?? 500;
          if (status === 204 || status === 205 || status === 304) {
            incoming.destroy();
            resolve(new Response(null, { status, headers }));
            return;
          }

          const encoding = headers.get("content-encoding")?.trim().toLowerCase();
          const decoder =
            encoding === "gzip" || encoding === "x-gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null;
          if (decoder !== null) pipeline(incoming, decoder, () => undefined);

          resolve(new Response(Readable.toWeb(decoder ?? incoming), { status, headers }));
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      });
      outgoing.on("error", reject);
      outgoing.end(body);
    });
}
