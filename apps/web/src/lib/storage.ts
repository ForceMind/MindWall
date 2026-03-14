const USER_TOKEN_KEY = 'mindwall.user.session_token';
const ADMIN_TOKEN_KEY = 'mindwall.admin.session_token';

export function loadUserToken() {
  return localStorage.getItem(USER_TOKEN_KEY) || '';
}

export function saveUserToken(token: string) {
  localStorage.setItem(USER_TOKEN_KEY, token);
}

export function clearUserToken() {
  localStorage.removeItem(USER_TOKEN_KEY);
}

export function loadAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function saveAdminToken(token: string) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}
