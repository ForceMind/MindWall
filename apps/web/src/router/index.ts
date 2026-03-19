import { createRouter, createWebHistory } from 'vue-router';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useUserSessionStore } from '@/stores/user-session';

const UserLoginView = () => import('@/views/user/UserLoginView.vue');
const UserRegisterView = () => import('@/views/user/UserRegisterView.vue');
const UserRestrictedView = () => import('@/views/user/UserRestrictedView.vue');
const OnboardingProfileView = () => import('@/views/user/OnboardingProfileView.vue');
const OnboardingInterviewView = () => import('@/views/user/OnboardingInterviewView.vue');
const DeepInterviewView = () => import('@/views/user/DeepInterviewView.vue');
const RefreshInterviewView = () => import('@/views/user/RefreshInterviewView.vue');
const OnboardingCityView = () => import('@/views/user/OnboardingCityView.vue');
const MatchListView = () => import('@/views/user/MatchListView.vue');
const UserProfileView = () => import('@/views/user/UserProfileView.vue');
const ChatRoomView = () => import('@/views/user/ChatRoomView.vue');

const AdminLoginView = () => import('@/views/admin/AdminLoginView.vue');
const AdminOverviewView = () => import('@/views/admin/AdminOverviewView.vue');
const AdminUsersView = () => import('@/views/admin/AdminUsersView.vue');
const AdminUserDetailView = () => import('@/views/admin/AdminUserDetailView.vue');
const AdminOnlineView = () => import('@/views/admin/AdminOnlineView.vue');
const AdminAiRecordsView = () => import('@/views/admin/AdminAiRecordsView.vue');
const AdminPromptsView = () => import('@/views/admin/AdminPromptsView.vue');
const AdminConfigView = () => import('@/views/admin/AdminConfigView.vue');
const AdminLogsView = () => import('@/views/admin/AdminLogsView.vue');
const AdminChatsView = () => import('@/views/admin/AdminChatsView.vue');
const AdminChatDetailView = () => import('@/views/admin/AdminChatDetailView.vue');

function resolveUserRoute(userStore: ReturnType<typeof useUserSessionStore>) {
  const viewer = userStore.viewer;
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

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/matches' },
    { path: '/login', component: UserLoginView, meta: { userPublic: true } },
    { path: '/register', component: UserRegisterView, meta: { userPublic: true } },
    { path: '/restricted', component: UserRestrictedView, meta: { requiresUser: true } },
    { path: '/onboarding/profile', component: OnboardingProfileView, meta: { requiresUser: true } },
    { path: '/onboarding/interview', component: OnboardingInterviewView, meta: { requiresUser: true } },
    { path: '/onboarding/deep', component: DeepInterviewView, meta: { requiresUser: true } },
    { path: '/onboarding/refresh', component: RefreshInterviewView, meta: { requiresUser: true } },
    { path: '/onboarding/city', component: OnboardingCityView, meta: { requiresUser: true } },
    { path: '/matches', component: MatchListView, meta: { requiresUser: true } },
    { path: '/profile', component: UserProfileView, meta: { requiresUser: true } },
    { path: '/chat/:kind/:id', component: ChatRoomView, meta: { requiresUser: true } },

    { path: '/admin/login', component: AdminLoginView, meta: { adminPublic: true } },
    { path: '/admin', redirect: '/admin/overview' },
    { path: '/admin/overview', component: AdminOverviewView, meta: { requiresAdmin: true } },
    { path: '/admin/users', component: AdminUsersView, meta: { requiresAdmin: true } },
    { path: '/admin/users/:userId', component: AdminUserDetailView, meta: { requiresAdmin: true } },
    { path: '/admin/online', component: AdminOnlineView, meta: { requiresAdmin: true } },
    { path: '/admin/ai-records', component: AdminAiRecordsView, meta: { requiresAdmin: true } },
    { path: '/admin/prompts', component: AdminPromptsView, meta: { requiresAdmin: true } },
    { path: '/admin/config', component: AdminConfigView, meta: { requiresAdmin: true } },
    { path: '/admin/chats', component: AdminChatsView, meta: { requiresAdmin: true } },
    { path: '/admin/chats/:type/:id', component: AdminChatDetailView, meta: { requiresAdmin: true } },
    { path: '/admin/logs', component: AdminLogsView, meta: { requiresAdmin: true } },

    { path: '/:pathMatch(.*)*', redirect: '/matches' },
  ],
});

router.beforeEach(async (to) => {
  const userStore = useUserSessionStore();
  const adminStore = useAdminSessionStore();

  if (to.meta.requiresAdmin || to.meta.adminPublic) {
    await adminStore.ensureBootstrap();

    if (to.meta.requiresAdmin && !adminStore.isAuthenticated) {
      return '/admin/login';
    }

    if (to.meta.adminPublic && adminStore.isAuthenticated) {
      return '/admin/overview';
    }

    return true;
  }

  await userStore.ensureBootstrap();

  if (to.meta.userPublic) {
    if (!userStore.isAuthenticated) {
      return true;
    }

    const route = resolveUserRoute(userStore);
    if (to.path !== route) {
      return route;
    }
    return true;
  }

  if (to.meta.requiresUser && !userStore.isAuthenticated) {
    return '/login';
  }

  if (to.meta.requiresUser && userStore.isAuthenticated) {
    const route = resolveUserRoute(userStore);
    const isOnboardingPath = to.path.startsWith('/onboarding');

    if (route.startsWith('/onboarding') && !isOnboardingPath) {
      return route;
    }

    if (route === '/matches' && isOnboardingPath) {
      // Allow active users to revisit interview for deep interview
      if (to.path === '/onboarding/interview' || to.path === '/onboarding/deep' || to.path === '/onboarding/refresh') {
        return true;
      }
      return '/matches';
    }

    if (route === '/restricted' && to.path !== '/restricted') {
      return '/restricted';
    }
  }

  return true;
});

export default router;
