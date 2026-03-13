export async function readApiError(
  response: Response,
  fallbackMessage: string,
) {
  try {
    const payload = (await response.json()) as {
      message?: string | string[];
      error?: string;
    };
    const message = Array.isArray(payload.message)
      ? payload.message.join("；")
      : payload.message || payload.error || "";
    return mapFriendlyError(message, fallbackMessage);
  } catch {
    try {
      const text = (await response.text()).trim();
      return mapFriendlyError(text, fallbackMessage);
    } catch {
      return fallbackMessage;
    }
  }
}

function mapFriendlyError(message: string, fallbackMessage: string) {
  const normalized = (message || "").trim();
  if (!normalized) {
    return fallbackMessage;
  }

  const rules: Array<[RegExp, string]> = [
    [/password must be at least 6 characters/i, "密码至少需要 6 位。"],
    [/password is required/i, "请输入密码。"],
    [/username is required/i, "请输入用户名。"],
    [/username must be between 2 and 24 characters/i, "用户名长度需要在 2 到 24 个字符之间。"],
    [/username can only contain/i, "用户名只能包含中文、字母、数字、下划线或短横线。"],
    [/username is already registered/i, "这个用户名已经被使用了，请换一个。"],
    [/invalid username or password/i, "用户名或密码不正确。"],
    [/authentication required/i, "请先登录后再继续。"],
    [/age is required/i, "请输入年龄。"],
    [/age must be between 18 and 99/i, "年龄需要在 18 到 99 岁之间。"],
    [/gender is required/i, "请选择性别。"],
    [/city is required/i, "请选择城市。"],
    [/message is required/i, "请输入你的回答。"],
    [/database is unavailable/i, "服务暂时不可用，请稍后再试。"],
    [/admin login required/i, "请先登录后台。"],
  ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(normalized)) {
      return replacement;
    }
  }

  if (/^\{.*\}$/.test(normalized)) {
    return fallbackMessage;
  }

  return normalized;
}
