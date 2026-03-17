export function statusText(status: string) {
  switch (status) {
    case 'onboarding':
      return '新手引导中';
    case 'active':
      return '正常';
    case 'restricted':
      return '受限';
    case 'pending':
      return '待建立';
    case 'active_sandbox':
      return '沙盒聊天中';
    case 'wall_broken':
      return '已破壁';
    case 'rejected':
      return '已拒绝';
    case 'passed':
      return '通过';
    case 'modified':
      return '改写';
    case 'blocked':
      return '拦截';
    default:
      return status;
  }
}

export function statusBadgeClass(status: string) {
  if (status === 'active' || status === 'wall_broken' || status === 'passed') {
    return 'badge-success';
  }
  if (status === 'restricted' || status === 'blocked' || status === 'rejected') {
    return 'badge-danger';
  }
  if (status === 'onboarding' || status === 'pending' || status === 'modified') {
    return 'badge-accent';
  }
  return 'badge-muted';
}

export function formatTime(value: string | number | Date | null | undefined) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateTime(value: string | number | Date | null | undefined) {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatUsd(value: number | null | undefined) {
  const numeric = Number(value || 0);
  return `$${numeric.toFixed(6)}`;
}
