import type { ViewerPayload } from './user-api';

export function resolvePostAuthRoute(viewer: ViewerPayload | null) {
  if (!viewer) {
    return '/login';
  }

  if (viewer.user.status === 'restricted') {
    return '/restricted';
  }

  const profile = viewer.profile;
  if (!profile?.gender || !profile?.age) {
    return '/onboarding/profile';
  }

  if (viewer.user.status === 'onboarding') {
    return '/onboarding/interview';
  }

  if (!profile?.city) {
    return '/onboarding/city';
  }

  return '/matches';
}
