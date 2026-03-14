import { ApiError, mapBackendMessage, parseErrorPayload } from './api-error';
import { appConfig } from './config';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function joinUrl(path: string) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${appConfig.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function safeJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function httpRequest<T>(path: string, options: RequestOptions = {}) {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(joinUrl(path), {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    const rawMessage = parseErrorPayload(payload);
    const message = mapBackendMessage(rawMessage, response.status);
    throw new ApiError(message, response.status, payload);
  }

  return (await safeJson(response)) as T;
}
