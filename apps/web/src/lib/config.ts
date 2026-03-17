function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function toWsOrigin(httpOrigin: string) {
  if (httpOrigin.startsWith('https://')) {
    return `wss://${httpOrigin.slice('https://'.length)}`;
  }
  if (httpOrigin.startsWith('http://')) {
    return `ws://${httpOrigin.slice('http://'.length)}`;
  }
  return httpOrigin;
}

function resolveDefaultApiBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/api`;
  }
  return 'http://localhost:3100';
}

function resolveDefaultWsBaseUrl(apiBaseUrl: string) {
  if (apiBaseUrl.startsWith('https://') || apiBaseUrl.startsWith('http://')) {
    // Strip /api suffix — WS endpoint is at /ws/sandbox, not /api/ws/sandbox
    const origin = apiBaseUrl.replace(/\/api\/?$/, '');
    return toWsOrigin(origin);
  }
  if (apiBaseUrl.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return toWsOrigin(window.location.origin);
    }
    return 'ws://localhost:3100';
  }
  return apiBaseUrl;
}

const apiBaseFromEnv = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const wsBaseFromEnv = String(import.meta.env.VITE_WS_BASE_URL || '').trim();

const apiBaseUrl = trimTrailingSlash(apiBaseFromEnv || resolveDefaultApiBaseUrl());
const wsBaseUrl = trimTrailingSlash(
  wsBaseFromEnv || resolveDefaultWsBaseUrl(apiBaseUrl),
);

export const appConfig = {
  apiBaseUrl,
  wsBaseUrl,
};
