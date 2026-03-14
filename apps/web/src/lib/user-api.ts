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
}

export interface AuthResponse extends ViewerPayload {
  session_token: string;
  expires_at: string;
}

export interface CandidateContact {
  candidate_id: string;
  candidate_type: 'user' | 'ai';
  disclosure: string;
  city: string | null;
  avatar: string | null;
  name: string;
  score: number;
  has_match: boolean;
  match_id: string | null;
  match_status: string | null;
  resonance_score: number | null;
  public_tags: PublicTag[];
}

export interface ContactSession {
  match_id: string;
  counterpart_user_id: string;
  candidate_type: 'user' | 'ai';
  disclosure: string;
  name: string;
  avatar: string | null;
  city: string | null;
  status: 'pending' | 'active_sandbox' | 'wall_broken' | 'rejected';
  resonance_score: number;
  ai_match_reason: string | null;
  updated_at: string;
  public_tags: PublicTag[];
}

export interface SandboxMessage {
  message_id: string;
  sender_id: string;
  original_text: string;
  ai_rewritten_text: string;
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

export function startOnboardingSession(token: string) {
  return httpRequest<{
    status: 'in_progress';
    session_id: string;
    assistant_message: string;
    remaining_questions: number;
  }>('/onboarding/me/session', {
    method: 'POST',
    token,
    body: {},
  });
}

export function sendOnboardingMessage(token: string, sessionId: string, message: string) {
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
  >(`/onboarding/me/session/${sessionId}/messages`, {
    method: 'POST',
    token,
    body: { message },
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
  }>('/contacts/me/candidates', {
    token,
  });
}

export function fetchContacts(token: string) {
  return httpRequest<{
    total: number;
    contacts: ContactSession[];
  }>('/contacts/me/list', {
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
) {
  return httpRequest<{
    mode: 'simulated_contact';
    contact_id: string;
    contact_name: string;
    reply: string;
  }>('/companion/respond', {
    method: 'POST',
    token,
    body: {
      companion_id: companionId,
      history,
    },
  });
}
