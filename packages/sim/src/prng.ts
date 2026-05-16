import type { PrngSnapshot } from "@drop-ship/protocol";

export type PrngStream = {
  name: string;
  state: number;
};

export function createPrngStream(seed: number, name: string): PrngStream {
  return {
    name,
    state: mixSeed(seed, name),
  };
}

export function nextUint32(stream: PrngStream): number {
  stream.state = (Math.imul(stream.state, 1664525) + 1013904223) >>> 0;
  return stream.state;
}

export function nextFloat01(stream: PrngStream): number {
  return nextUint32(stream) / 0x1_0000_0000;
}

export function findPrngStream(
  streams: readonly PrngStream[],
  name: string
): PrngStream {
  const stream = streams.find((candidate) => candidate.name === name);

  if (!stream) {
    throw new Error(`Missing PRNG stream ${name}`);
  }

  return stream;
}

export function snapshotPrngStreams(
  streams: readonly PrngStream[]
): readonly PrngSnapshot[] {
  return streams
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((stream) => ({
      name: stream.name,
      state: stream.state,
    }));
}

export function restorePrngStreams(
  snapshots: readonly PrngSnapshot[]
): readonly PrngStream[] {
  return snapshots.map((snapshot) => ({
    name: snapshot.name,
    state: snapshot.state >>> 0,
  }));
}

function mixSeed(seed: number, name: string): number {
  let hash = seed >>> 0;

  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash || 1;
}
