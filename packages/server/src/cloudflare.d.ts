type DurableObjectId = unknown;

type DurableObjectStub = {
  fetch: (request: Request) => Promise<Response>;
};

type DurableObjectNamespace = {
  idFromName: (name: string) => DurableObjectId;
  get: (id: DurableObjectId) => DurableObjectStub;
};

type ExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
};

type Fetcher = {
  fetch: (request: Request) => Promise<Response>;
};

interface WebSocket {
  accept: () => void;
}

interface ResponseInit {
  webSocket?: WebSocket;
}

declare const WebSocketPair: {
  new (): {
    0: WebSocket;
    1: WebSocket;
  };
};
