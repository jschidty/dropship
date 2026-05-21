type DurableObjectId = unknown;

type DurableObjectStub = {
  fetch: (request: Request) => Promise<Response>;
};

type DurableObjectNamespace = {
  idFromName: (name: string) => DurableObjectId;
  get: (id: DurableObjectId) => DurableObjectStub;
};

type DurableObjectStorageListOptions = {
  prefix?: string;
};

type DurableObjectStorage = {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  put: <T = unknown>(key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<boolean>;
  list: <T = unknown>(
    options?: DurableObjectStorageListOptions
  ) => Promise<Map<string, T>>;
};

type DurableObjectState = {
  storage: DurableObjectStorage;
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
