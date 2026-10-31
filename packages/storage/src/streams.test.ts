import { describe, expect, test } from "bun:test";
import { downloadStream, uploadStream } from "./index";

// A stand-in for Bun.S3Client with just the calls the helpers use.
function fakeUploadClient(opts: { failAfterWrites?: number } = {}) {
  const state = { written: [] as number[], ended: 0, deleted: [] as string[] };
  const client = {
    file: () => ({
      writer: () => ({
        write(chunk: Uint8Array) {
          if (opts.failAfterWrites !== undefined && state.written.length >= opts.failAfterWrites) throw new Error("S3 refused the part");
          state.written.push(chunk.byteLength);
          return chunk.byteLength;
        },
        async end() {
          state.ended++;
        },
      }),
    }),
    delete: async (key: string) => {
      state.deleted.push(key);
    },
  };
  return { client: client as unknown as Bun.S3Client, state };
}

async function* chunks(...sizes: number[]) {
  for (const n of sizes) yield new Uint8Array(n);
}

describe("uploadStream", () => {
  test("sends every chunk and reports the byte count", async () => {
    const { client, state } = fakeUploadClient();
    const sent = await uploadStream(client, "k", chunks(10, 20, 30));
    expect(sent).toBe(60);
    expect(state.written).toEqual([10, 20, 30]);
    expect(state.ended).toBe(1);
    expect(state.deleted).toEqual([]);
  });

  test("waits for the writer when it reports back-pressure", async () => {
    let active = 0;
    let maxActive = 0;
    const client = {
      file: () => ({
        writer: () => ({
          write(chunk: Uint8Array) {
            active++;
            maxActive = Math.max(maxActive, active);
            return new Promise<number>((resolve) => setTimeout(() => (active--, resolve(chunk.byteLength)), 5));
          },
          async end() {},
        }),
      }),
      delete: async () => {},
    } as unknown as Bun.S3Client;
    await uploadStream(client, "k", chunks(1, 1, 1, 1));
    expect(maxActive).toBe(1);
  });

  test("a failing source deletes the partial object and rethrows", async () => {
    const { client, state } = fakeUploadClient();
    async function* broken() {
      yield new Uint8Array(5);
      throw new Error("connection lost");
    }
    await expect(uploadStream(client, "partial", broken())).rejects.toThrow("connection lost");
    expect(state.deleted).toEqual(["partial"]);
  });

  test("a failing write also cleans up", async () => {
    const { client, state } = fakeUploadClient({ failAfterWrites: 1 });
    await expect(uploadStream(client, "p2", chunks(5, 5, 5))).rejects.toThrow("S3 refused the part");
    expect(state.deleted).toEqual(["p2"]);
  });
});

describe("downloadStream", () => {
  const data = Uint8Array.from({ length: 25 }, (_, i) => i);
  const client = {
    file: () => ({
      stat: async () => ({ size: data.byteLength }),
      slice: (start: number, end: number) => ({ arrayBuffer: async () => data.slice(start, end).buffer }),
    }),
  } as unknown as Bun.S3Client;

  test("reads the object in ranges and reassembles it exactly", async () => {
    const parts: number[][] = [];
    for await (const part of downloadStream(client, "k", 10)) parts.push([...part]);
    expect(parts.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(parts.flat()).toEqual([...data]);
  });

  test("an empty object yields nothing", async () => {
    const empty = { file: () => ({ stat: async () => ({ size: 0 }), slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) }) } as unknown as Bun.S3Client;
    const parts: Uint8Array[] = [];
    for await (const part of downloadStream(empty, "k")) parts.push(part);
    expect(parts).toEqual([]);
  });
});
