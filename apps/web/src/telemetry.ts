import * as Sentry from "@sentry/browser";
import type { ClientIssueReport } from "@drop-ship/client";

type TelemetryLevel = NonNullable<ClientIssueReport["level"]>;

type GameTelemetryContext = Readonly<{
  matchId?: string;
  serverUrl?: string;
  network: boolean;
  renderMode?: string;
  routePath: string;
}>;

type NetworkIssueOptions = Readonly<{
  kind: string;
  message: string;
  method?: string;
  url?: string;
  status?: number;
  level?: TelemetryLevel;
  error?: unknown;
  context?: Readonly<Record<string, unknown>>;
}>;

type NavigatorWithOptionalFields = Navigator &
  Readonly<{
    connection?: NetworkInformationLike;
    deviceMemory?: number;
  }>;

type NetworkInformationLike = EventTarget &
  Readonly<{
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  }>;

type WebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

let telemetryEnabled = false;
let browserListenersInstalled = false;

export function initTelemetry(): void {
  const dsn = readEnvString("VITE_SENTRY_DSN");
  const explicitlyEnabled = readBooleanEnv("VITE_SENTRY_ENABLED");

  if (explicitlyEnabled === false || !dsn) {
    return;
  }

  const release =
    readEnvString("VITE_SENTRY_RELEASE") ??
    (window as Window & { SENTRY_RELEASE?: { id?: string } }).SENTRY_RELEASE?.id;

  const client = Sentry.init({
    dsn,
    environment:
      readEnvString("VITE_SENTRY_ENVIRONMENT") ??
      (import.meta.env.DEV ? "development" : "production"),
    release,
    attachStacktrace: true,
    tracesSampleRate: readSampleRateEnv("VITE_SENTRY_TRACES_SAMPLE_RATE") ?? 0.1,
    tracePropagationTargets: [window.location.origin, /^\/api\//],
    integrations: [
      Sentry.browserTracingIntegration({
        beforeStartSpan: (options) => ({
          ...options,
          name: normalizeTransactionName(window.location.pathname),
        }),
        shouldCreateSpanForRequest: (url) => !isSentryEnvelopeUrl(url),
      }),
      Sentry.httpClientIntegration({
        failedRequestStatusCodes: [[400, 599]],
        failedRequestTargets: [window.location.origin, /^\/api\//],
      }),
      Sentry.reportingObserverIntegration({
        types: ["crash", "deprecation", "intervention"],
      }),
      Sentry.captureConsoleIntegration({
        levels: ["error", "assert"],
      }),
    ],
    beforeSend: (event) => {
      event.tags = {
        ...event.tags,
        online: String(navigator.onLine),
      };
      return event;
    },
  });

  telemetryEnabled = Boolean(client);

  if (!telemetryEnabled) {
    return;
  }

  Sentry.setTag("app", "drop-ship-web");
  Sentry.setTag("runtime", "browser");
  updateBrowserContext();
  reportInitialWebGLStatus();
  installBrowserIssueListeners();
}

export function setGameTelemetryContext(context: GameTelemetryContext): void {
  if (!telemetryEnabled) {
    return;
  }

  Sentry.setTag("game.mode", context.network ? "network" : "local");
  Sentry.setTag("game.render_mode", context.renderMode ?? "default");
  Sentry.setContext("game", {
    matchId: context.matchId ?? null,
    mode: context.network ? "network" : "local",
    renderMode: context.renderMode ?? null,
    routePath: context.routePath,
    serverOrigin: readUrlOrigin(context.serverUrl) ?? "same-origin",
  });
}

export function reportPreactError(error: Error): void {
  captureException(error, {
    tags: {
      "ui.layer": "preact",
      "client.issue": "browser.preact_error",
    },
    contexts: {
      preact: {
        routePath: window.location.pathname,
      },
    },
  });
}

export function reportGameMountError(
  error: unknown,
  context: Readonly<Record<string, unknown>>
): void {
  captureException(error, {
    tags: {
      "client.issue": "game.mount_error",
    },
    contexts: {
      game_mount: context,
    },
  });
}

export function reportClientIssue(issue: ClientIssueReport): void {
  if (!telemetryEnabled) {
    return;
  }

  Sentry.addBreadcrumb({
    category: issue.kind.startsWith("network.") ? "network" : "client",
    message: issue.message,
    level: issue.level ?? "error",
    data: issue.context,
  });

  Sentry.captureMessage(issue.message, {
    level: issue.level ?? "error",
    tags: {
      "client.issue": issue.kind,
    },
    contexts: {
      client_issue: {
        kind: issue.kind,
        ...(issue.context ?? {}),
      },
    },
    fingerprint: [issue.kind],
  });
}

export function reportNetworkIssue(options: NetworkIssueOptions): void {
  if (!telemetryEnabled) {
    return;
  }

  const context = {
    method: options.method ?? null,
    status: options.status ?? null,
    url: sanitizeUrl(options.url) ?? null,
    online: navigator.onLine,
    errorMessage: getErrorMessage(options.error),
    ...(options.context ?? {}),
  };

  if (options.error) {
    captureException(options.error, {
      level: options.level ?? "error",
      tags: {
        "client.issue": options.kind,
        "network.status": options.status?.toString() ?? "unknown",
      },
      contexts: {
        network: context,
      },
      fingerprint: [options.kind, options.status?.toString() ?? "network"],
    });
    return;
  }

  Sentry.captureMessage(options.message, {
    level: options.level ?? "error",
    tags: {
      "client.issue": options.kind,
      "network.status": options.status?.toString() ?? "unknown",
    },
    contexts: {
      network: context,
    },
    fingerprint: [options.kind, options.status?.toString() ?? "network"],
  });
}

function installBrowserIssueListeners(): void {
  if (browserListenersInstalled) {
    return;
  }

  browserListenersInstalled = true;

  window.addEventListener("offline", () => {
    updateBrowserContext();
    Sentry.addBreadcrumb({
      category: "network",
      message: "Browser reported offline.",
      level: "warning",
    });
    Sentry.captureMessage("Browser reported offline.", {
      level: "warning",
      tags: {
        "client.issue": "browser.offline",
      },
      fingerprint: ["browser.offline"],
    });
  });

  window.addEventListener("online", () => {
    updateBrowserContext();
    Sentry.addBreadcrumb({
      category: "network",
      message: "Browser reported online.",
      level: "info",
    });
  });

  window.addEventListener("error", reportResourceLoadError, true);

  const connection = (navigator as NavigatorWithOptionalFields).connection;
  connection?.addEventListener?.("change", updateBrowserContext);
}

function reportResourceLoadError(event: ErrorEvent | Event): void {
  const target = event.target;

  if (!(target instanceof HTMLElement) || target === window) {
    return;
  }

  const source = readResourceElementSource(target);

  if (!source) {
    return;
  }

  Sentry.captureMessage("Browser resource failed to load.", {
    level: "warning",
    tags: {
      "client.issue": "browser.resource_load_error",
      "resource.tag": target.tagName.toLowerCase(),
    },
    contexts: {
      resource: {
        tagName: target.tagName,
        url: sanitizeUrl(source),
      },
    },
    fingerprint: ["browser.resource_load_error", target.tagName.toLowerCase()],
  });
}

function reportInitialWebGLStatus(): void {
  const webgl = detectWebGLCapabilities();

  Sentry.setTag("webgl.supported", String(webgl.supported));
  Sentry.setTag("webgl.version", webgl.webgl2 ? "2" : webgl.webgl1 ? "1" : "none");
  Sentry.setContext("webgl", webgl);

  if (!webgl.supported) {
    Sentry.captureMessage("WebGL is unavailable.", {
      level: "error",
      tags: {
        "client.issue": "webgl.unavailable",
      },
      fingerprint: ["webgl.unavailable"],
    });
    return;
  }

  if (webgl.majorPerformanceCaveat) {
    Sentry.captureMessage("WebGL is available only with a major performance caveat.", {
      level: "warning",
      tags: {
        "client.issue": "webgl.major_performance_caveat",
      },
      fingerprint: ["webgl.major_performance_caveat"],
    });
  }
}

function detectWebGLCapabilities(): Record<string, unknown> & {
  supported: boolean;
  webgl1: boolean;
  webgl2: boolean;
  majorPerformanceCaveat: boolean;
} {
  const webgl2 = createWebGLContext(document.createElement("canvas"), "webgl2");
  const webgl1 =
    createWebGLContext(document.createElement("canvas"), "webgl") ??
    createWebGLContext(document.createElement("canvas"), "experimental-webgl");
  const fastContext =
    createWebGLContext(document.createElement("canvas"), "webgl2", {
      failIfMajorPerformanceCaveat: true,
    }) ??
    createWebGLContext(document.createElement("canvas"), "webgl", {
      failIfMajorPerformanceCaveat: true,
    });
  const gl = webgl2 ?? webgl1;
  const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info") ?? null;
  const webgl = {
    supported: Boolean(gl),
    webgl1: Boolean(webgl1),
    webgl2: Boolean(webgl2),
    majorPerformanceCaveat: Boolean(gl && !fastContext),
    vendor:
      gl && debugInfo
        ? readWebGLParameter(gl, debugInfo.UNMASKED_VENDOR_WEBGL)
        : null,
    renderer:
      gl && debugInfo
        ? readWebGLParameter(gl, debugInfo.UNMASKED_RENDERER_WEBGL)
        : null,
    shadingLanguageVersion: gl
      ? readWebGLParameter(gl, gl.SHADING_LANGUAGE_VERSION)
      : null,
    maxTextureSize: gl ? readWebGLParameter(gl, gl.MAX_TEXTURE_SIZE) : null,
    maxRenderbufferSize: gl
      ? readWebGLParameter(gl, gl.MAX_RENDERBUFFER_SIZE)
      : null,
    maxSamples:
      gl && "MAX_SAMPLES" in gl ? readWebGLParameter(gl, gl.MAX_SAMPLES) : null,
  };

  releaseWebGLContext(webgl2);
  releaseWebGLContext(webgl1);
  releaseWebGLContext(fastContext);

  return webgl;
}

function updateBrowserContext(): void {
  const nav = navigator as NavigatorWithOptionalFields;

  Sentry.setContext("browser_capabilities", {
    online: navigator.onLine,
    cookiesEnabled: navigator.cookieEnabled,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: nav.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints,
    connection: nav.connection
      ? {
          type: nav.connection.type ?? null,
          effectiveType: nav.connection.effectiveType ?? null,
          downlink: nav.connection.downlink ?? null,
          rtt: nav.connection.rtt ?? null,
          saveData: nav.connection.saveData ?? null,
        }
      : null,
  });
}

function captureException(
  error: unknown,
  context: Parameters<typeof Sentry.captureException>[1]
): void {
  if (!telemetryEnabled) {
    return;
  }

  Sentry.captureException(error, context);
}

function readEnvString(name: string): string | undefined {
  const value = (import.meta.env as unknown as Record<string, unknown>)[name];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBooleanEnv(name: string): boolean | undefined {
  const value = readEnvString(name)?.toLowerCase();

  if (value === undefined) {
    return undefined;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  return undefined;
}

function readSampleRateEnv(name: string): number | undefined {
  const value = readEnvString(name);

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : undefined;
}

function createWebGLContext(
  canvas: HTMLCanvasElement,
  contextId: "webgl" | "webgl2" | "experimental-webgl",
  attributes?: WebGLContextAttributes
): WebGLContext | null {
  try {
    return canvas.getContext(contextId, attributes) as WebGLContext | null;
  } catch {
    return null;
  }
}

function readWebGLParameter(gl: WebGLContext, parameter: number): unknown {
  try {
    return gl.getParameter(parameter) as unknown;
  } catch {
    return null;
  }
}

function releaseWebGLContext(gl: WebGLContext | null): void {
  try {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Context probing should not affect app startup.
  }
}

function readResourceElementSource(target: HTMLElement): string | undefined {
  if (target instanceof HTMLScriptElement) {
    return target.src || undefined;
  }

  if (target instanceof HTMLLinkElement) {
    return target.href || undefined;
  }

  if (
    target instanceof HTMLImageElement ||
    target instanceof HTMLAudioElement ||
    target instanceof HTMLVideoElement ||
    target instanceof HTMLSourceElement
  ) {
    return target.currentSrc || target.src || undefined;
  }

  return undefined;
}

function sanitizeUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value, window.location.href);

    return `${url.origin}${url.pathname}`;
  } catch {
    return value.slice(0, 200);
  }
}

function readUrlOrigin(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value, window.location.href).origin;
  } catch {
    return undefined;
  }
}

function normalizeTransactionName(pathname: string): string {
  if (/^\/play\/[^/]+\/?$/.test(pathname)) {
    return "/play/:gameId";
  }

  return pathname || "/";
}

function isSentryEnvelopeUrl(url: string): boolean {
  return /\/api\/\d+\/envelope\/?/.test(url);
}

function getErrorMessage(error: unknown): string | null {
  if (error === undefined || error === null) {
    return null;
  }

  return error instanceof Error ? error.message : String(error);
}
