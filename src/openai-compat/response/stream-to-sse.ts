import type { EventEmitter } from "node:events";
import type { TextStreamPart, ToolSet } from "ai";
import type { ChunkMapper } from "../translate/stream-chunks.js";

/** The slice of Node's ServerResponse the SSE writer uses. */
export interface SseResponse extends EventEmitter {
  write(chunk: string): boolean;
  end(): void;
}

export const KEEP_ALIVE_MS = 15_000;

// SPEC-006: the error event after the commit. No `[DONE]` follows, so the client can tell an
// interruption from a normal end. The wording is the spec's.
const STREAM_ERROR = {
  error: {
    message: "upstream interrompeu a geração",
    type: "api_error",
    code: "upstream_stream_error",
  },
};

/**
 * SPEC-006: writes the mapped chunks as SSE straight to the response, honoring backpressure.
 * While nothing is written for `keepAliveMs` it sends a `: keep-alive` comment, so proxies with
 * an idle timeout keep the connection. It always ends the response.
 */
export async function streamToSse(input: {
  res: SseResponse;
  parts: AsyncIterable<TextStreamPart<ToolSet>>;
  mapper: ChunkMapper;
  keepAliveMs?: number;
}): Promise<void> {
  const { res, parts, mapper, keepAliveMs = KEEP_ALIVE_MS } = input;
  let closed = false;
  const markClosed = () => {
    closed = true;
  };
  res.once("close", markClosed);

  let timer: NodeJS.Timeout | undefined;
  const armKeepAlive = () => {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!closed) res.write(": keep-alive\n\n");
    }, keepAliveMs);
  };
  /** Resolves on `drain`, or when the client leaves (no `drain` will ever come then). */
  const drained = () =>
    new Promise<void>((resolve) => {
      if (closed) return resolve();
      const done = () => {
        res.off("drain", done);
        res.off("close", done);
        resolve();
      };
      res.once("drain", done);
      res.once("close", done);
    });
  const send = async (text: string) => {
    if (closed) return;
    const roomLeft = res.write(text);
    armKeepAlive();
    if (!roomLeft) await drained();
  };
  const sendData = (data: unknown) => send(`data: ${JSON.stringify(data)}\n\n`);

  try {
    armKeepAlive();
    let failed = false;
    for await (const part of parts) {
      if (closed) break;
      for (const event of mapper.map(part)) {
        if (event.kind === "error") failed = true;
        else await sendData(event.chunk);
      }
      if (failed) break;
    }
    if (failed || !mapper.finished) await sendData(STREAM_ERROR);
    else await send("data: [DONE]\n\n");
  } catch {
    await sendData(STREAM_ERROR);
  } finally {
    clearInterval(timer);
    res.off("close", markClosed);
    res.end();
  }
}
