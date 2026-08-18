export function getApiErrorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && isUsefulMessage(value.message)) {
    return value.message;
  }

  const responseData =
    value &&
    typeof value === "object" &&
    "response" in value &&
    (value as { response?: { data?: unknown } }).response?.data !== undefined
      ? (value as { response: { data: unknown } }).response.data
      : value;

  if (typeof responseData === "string" && isUsefulMessage(responseData)) {
    return responseData;
  }
  if (!responseData || typeof responseData !== "object") {
    return fallback;
  }

  const payload = responseData as Record<string, unknown>;
  if (typeof payload.message === "string" && isUsefulMessage(payload.message)) {
    return payload.message;
  }
  if (Array.isArray(payload.message)) {
    const messages = payload.message.filter(
      (item): item is string => typeof item === "string" && Boolean(item.trim()),
    );
    if (messages.length > 0) return messages.join("; ");
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  if (payload.message && typeof payload.message === "object") {
    return getApiErrorMessage(payload.message, fallback);
  }
  if (payload.error && typeof payload.error === "object") {
    return getApiErrorMessage(payload.error, fallback);
  }
  return fallback;
}

function isUsefulMessage(value: string): boolean {
  const normalized = value.trim();
  return Boolean(normalized) && normalized !== "[object Object]";
}
