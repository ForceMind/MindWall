export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function toErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '发生未知错误，请稍后再试。';
}

export function mapBackendMessage(rawMessage: string, status: number) {
  const msg = (rawMessage || '').trim();
  if (!msg) {
    return status >= 500
      ? '服务暂时不可用，请稍后重试。'
      : '请求失败，请检查输入后重试。';
  }

  const lower = msg.toLowerCase();

  if (lower.includes('username is already registered')) {
    return '该用户名已被注册，请更换用户名。';
  }
  if (lower.includes('invalid username or password')) {
    return '用户名或密码错误。';
  }
  if (lower.includes('password must be at least 6 characters')) {
    return '密码至少需要 6 位。';
  }
  if (lower.includes('username is required')) {
    return '请输入用户名。';
  }
  if (lower.includes('password is required')) {
    return '请输入密码。';
  }
  if (lower.includes('admin credentials are not configured')) {
    return '服务器尚未配置管理员账号，请先在服务器环境变量中设置 ADMIN_USERNAME 与 ADMIN_PASSWORD。';
  }
  if (lower.includes('admin login required')) {
    return '管理员登录已失效，请重新登录。';
  }
  if (lower.includes('database is unavailable')) {
    return '数据库未启动或不可用，请先启动 PostgreSQL。';
  }
  if (lower.includes('onboarding session not found')) {
    return '访谈会话已失效，请重新开始。';
  }

  return msg;
}

export function parseErrorPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const record = payload as {
    message?: unknown;
    error?: unknown;
    statusCode?: unknown;
  };

  if (Array.isArray(record.message)) {
    const values = record.message
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return values.join('；');
  }

  if (typeof record.message === 'string') {
    return record.message;
  }

  if (typeof record.error === 'string') {
    return record.error;
  }

  return '';
}
