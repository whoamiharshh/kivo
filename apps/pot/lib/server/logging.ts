import "server-only";

const SAFE_LABEL = /^[A-Za-z0-9_.-]{1,60}$/;
const SAFE_CODE = /^[0-9A-Z]{5}$/;

export function safeErrorMetadata(error: unknown): {
  errorName: string;
  code?: string;
} {
  const candidate =
    error && typeof error === "object"
      ? (error as { name?: unknown; code?: unknown })
      : undefined;
  const name = candidate?.name;
  const code = candidate?.code;

  return {
    errorName:
      typeof name === "string" && SAFE_LABEL.test(name) ? name : "UnknownError",
    ...(typeof code === "string" && SAFE_CODE.test(code) ? { code } : {}),
  };
}

export function logServerError(scope: string, error: unknown): void {
  console.error(`[${scope}]`, safeErrorMetadata(error));
}