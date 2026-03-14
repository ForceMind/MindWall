function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function toWsBase(httpBase: string) {
  if (httpBase.startsWith('https://')) {
    return `wss://${httpBase.slice('https://'.length)}`;
  }
  if (httpBase.startsWith('http://')) {
    return `ws://${httpBase.slice('http://'.length)}`;
  }
  return httpBase;
}

const apiBaseFromEnv = String(import.meta.env.VITE_API_BASE_URL || '').trim();
const wsBaseFromEnv = String(import.meta.env.VITE_WS_BASE_URL || '').trim();

const apiBaseUrl = trimTrailingSlash(apiBaseFromEnv || 'http://localhost:3100');
const wsBaseUrl = trimTrailingSlash(wsBaseFromEnv || toWsBase(apiBaseUrl));

export const appConfig = {
  apiBaseUrl,
  wsBaseUrl,
};
