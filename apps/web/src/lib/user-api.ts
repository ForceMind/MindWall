import { httpRequest } from './http';

export interface PublicTag {
  tag_name: string;
  weight: number;
  ai_justification: string;
}

export interface ViewerPayload {
  user: {
    id: string;
    username: string;
    status: 'onboarding' | 'active' | 'restricted';
    created_at: string;
  };
  profile: {
    real_name: string | null;
    real_avatar: string | null;
    anonymous_name: string | null;
    anonymous_avatar: string | null;
    gender: string | null;
    age: number | null;
    city: string | null;
    is_wall_broken: boolean;
  } | null;
  public_tags: PublicTag[];
    has_deep_interview?: boolean;
  resonance_score: number | null;
  public_tags: PublicTag[];
}

export interface ContactSession {
  match_id: string;
  counterpart_user_id?: string;
  candidate_type: 'user' | 'ai';
  is_ai?: boolean;
  disclosure: string;
  name: string;
  avatar: string | null;
  city?: string | null;
  status: string;
  resonance_score?: number | null;
  ai_match_reason?: string | null;
  updated_at: string;
  public_tags?: PublicTag[];
}

export interface CandidateContact {
  candidate_id: string;
  candidate_type: 'user' | 'ai';
  is_ai?: boolean;
  disclosure: string;
  city?: string | null;
  avatar?: string | null;
  name: string;
  score: number;
  has_match?: boolean;
  match_id?: string | null;
  match_status?: string | null;
  resonance_score?: number | null;
  public_tags?: PublicTag[];
}

export interface SandboxMessage {
  message_id: string;
  sender_id: string;
  original_text: string;
  ai_rewritten_text: string;
  sender_rewritten_text?: string;
  ai_action: 'passed' | 'blocked' | 'modified';
  hidden_tag_updates: Record<string, number> | null;
  created_at: string;
}

export interface WallState {
  matchId: string;
  status: 'pending' | 'active_sandbox' | 'wall_broken' | 'rejected';
  resonanceScore: number;
  wallReady: boolean;
  wallBroken: boolean;
  requesterAccepted: boolean;
  counterpartAccepted: boolean;
  consents: {
    userAId: string;
    userBId: string;
    userAAccepted: boolean;
    userBAccepted: boolean;
  };
  counterpartProfile: {
    userId: string;
    anonymousName: string | null;
    anonymousAvatar: string | null;
    realName: string | null;
    realAvatar: string | null;
  };
  selfProfile: {
    userId: string;
    anonymousName: string | null;
    anonymousAvatar: string | null;
    realName: string | null;
    realAvatar: string | null;
  };
}

export function registerUser(username: string, password: string) {
  return httpRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: { username, password },
  });
}

export function loginUser(username: string, password: string) {
  return httpRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
}

export function fetchCurrentUser(token: string) {
  return httpRequest<ViewerPayload>('/auth/me', {
    token,
  });
}

export function logoutUser(token: string) {
  return httpRequest<{ status: 'ok' }>('/auth/logout', {
    method: 'POST',
    token,
  });
}

export function saveOnboardingProfile(
  token: string,
  payload: { gender: string; age: number },
) {
  return httpRequest<{
    status: 'ok';
    message: string;
    profile: ViewerPayload['profile'];
  }>('/onboarding/me/profile', {
    method: 'POST',
    token,
    body: payload,
  });
}

export function startOnboardingSession(token: string, type: 'onboarding' | 'deep' | 'refresh' = 'onboarding') {
  return httpRequest<{
    status: 'in_progress';
    session_id: string;
    assistant_message: string;
    remaining_questions: number;
    turns?: Array<{ role: string; content: string }>;
  }>('/onboarding/me/session', {
    method: 'POST',
    token,
    body: { type },
  });
}

export function sendOnboardingMessage(token: string, sessionId: string, message: string, skip?: boolean) {
  return httpRequest<
    | {
        status: 'in_progress';
        session_id: string;
        assistant_message: string;
        remaining_questions: number;
      }
    | {
        status: 'completed';
        user_id: string;
        public_tags: PublicTag[];
        onboarding_summary: string;
      }
    | {
        status: 'invalid_input';
        session_id: string;
        warning: string;
        invalid_attempts: number;
        remaining_before_ban: number;
      }
  >(`/onboarding/me/session/${sessionId}/messages`, {
    method: 'POST',
    token,
    body: { message, skip },
  });
}

export function skipOnboardingSession(token: string, sessionId: string) {
  return httpRequest<{
    status: 'completed';
    user_id: string;
    public_tags: PublicTag[];
    onboarding_summary: string;
  }>(`/onboarding/me/session/${sessionId}/skip`, {
    method: 'POST',
    token,
    body: {},
  });
}

export function saveOnboardingCity(token: string, city: string) {
  return httpRequest<{
    status: 'ok';
    message: string;
    profile: ViewerPayload['profile'];
  }>('/onboarding/me/city', {
    method: 'POST',
    token,
    body: { city },
  });
}

export function fetchCandidates(token: string) {
  return httpRequest<{
    city_scope: string | null;
    candidates: CandidateContact[];
    ai_chat_candidates: CandidateContact[];
  }>('/contacts/me/candidates', {
    token,
  });
}

export function fetchContacts(token: string, tab: string = 'active', page: number = 1) {
  return httpRequest<{
    total: number;
    page: number;
    contacts: ContactSession[];
  }>(`/contacts/me/list?tab=${tab}&page=${page}`, {
    token,
  });
}

export function connectCandidate(token: string, targetUserId: string) {
  return httpRequest<{
    existed: boolean;
    match_id: string;
    status: ContactSession['status'];
    resonance_score: number;
  }>('/contacts/me/connect', {
    method: 'POST',
    token,
    body: { target_user_id: targetUserId },
  });
}

export function fetchCompanionMessages(token: string, sessionId: string) {
  return httpRequest<any>(`/companion/sessions/${sessionId}/messages`, { token });
}

export function fetchMatchMessages(token: string, matchId: string, limit = 80) {
  return httpRequest<{
    match_id: string;
    total: number;
    messages: SandboxMessage[];
  }>(`/sandbox/me/matches/${matchId}/messages?limit=${limit}`, {
    token,
  });
}

export function fetchWallState(token: string, matchId: string) {
  return httpRequest<WallState>(`/sandbox/me/matches/${matchId}/wall-state`, {
    token,
  });
}

export function submitWallDecision(token: string, matchId: string, accept: boolean) {
  return httpRequest<WallState>(`/sandbox/me/matches/${matchId}/wall-decision`, {
    method: 'POST',
    token,
    body: { accept },
  });
}

export function askCompanion(
  token: string,
  companionId: string,
  history: Array<{ role: string; text: string }>,
  sessionId?: string,
  isChatPool?: boolean,
) {
  return httpRequest<{
    contact_id: string;
    contact_name: string;
    reply: string;
    session_id?: string;
    sender_summary?: string;
    reply_relay?: string;
    resonance_score?: number;
    wall_ready?: boolean;
  }>('/companion/respond', {
    method: 'POST',
    token,
    body: {
      companion_id: companionId,
      session_id: sessionId,
      history,
      is_chat_pool: isChatPool || undefined,
    },
  });
}
