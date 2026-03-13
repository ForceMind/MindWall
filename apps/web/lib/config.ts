export const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:3100";

export const wsBaseUrl =
  process.env.NEXT_PUBLIC_WS_BASE_URL?.trim() ||
  apiBaseUrl.replace(/^http/i, (value) =>
    value.toLowerCase() === "https" ? "wss" : "ws",
  );
