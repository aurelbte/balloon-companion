import type { SupabaseClient } from "@supabase/supabase-js";

export const FRIEND_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._]{1,28}[a-z0-9])$/;

export type FriendProfile = Readonly<{ userId: string; displayName: string; handle: string; searchEnabled: boolean }>;
export type FriendRequest = Readonly<{ id: string; sender: FriendProfile; createdAt: string }>;
export type Friendship = Readonly<{ id: string; friend: FriendProfile; createdAt: string }>;
export type FriendsSnapshot = Readonly<{ ownProfile: FriendProfile | null; friends: Friendship[]; receivedRequests: FriendRequest[] }>;

type FriendProfileRow = { user_id: string; display_name: string; handle: string; search_enabled: boolean };

export function normalizeFriendHandle(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function proposeFriendHandle(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 30)
    .replace(/\.+$/g, "");
}

export function friendOnboardingDefaults(input: {
  authFirstName: string;
  authLastName: string;
  profileFirstName?: string;
  profileLastName?: string;
}): { displayName: string; handle: string } {
  const firstName = input.profileFirstName?.trim() || input.authFirstName.trim();
  const lastName = input.profileLastName?.trim() || input.authLastName.trim();
  return {
    displayName: [firstName, lastName].filter(Boolean).join(" "),
    handle: proposeFriendHandle(firstName, lastName),
  };
}

export function validateFriendHandle(value: string): string | null {
  const handle = normalizeFriendHandle(value);
  if (!FRIEND_HANDLE_PATTERN.test(handle)) return "Utilisez 3 à 30 caractères : lettres, chiffres, point ou tiret bas.";
  return null;
}

function profileFromRow(row: FriendProfileRow): FriendProfile {
  return { userId: row.user_id, displayName: row.display_name, handle: row.handle, searchEnabled: row.search_enabled };
}

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw new Error(error.code ? `${error.code}: ${error.message}` : error.message);
}

async function profilesByIds(client: SupabaseClient, ids: readonly string[]): Promise<Map<string, FriendProfile>> {
  if (ids.length === 0) return new Map();
  const result = await client.from("friend_profiles").select("user_id,display_name,handle,search_enabled").in("user_id", [...new Set(ids)]);
  fail(result.error);
  return new Map(((result.data ?? []) as FriendProfileRow[]).map((row) => [row.user_id, profileFromRow(row)]));
}

export async function loadFriendsSnapshot(client: SupabaseClient, userId: string): Promise<FriendsSnapshot> {
  const [own, relations, requests] = await Promise.all([
    client.from("friend_profiles").select("user_id,display_name,handle,search_enabled").eq("user_id", userId).maybeSingle(),
    client.from("friendships").select("id,user_a,user_b,created_at").is("revoked_at", null).order("created_at", { ascending: false }),
    client.from("friend_requests").select("id,sender_id,created_at").eq("recipient_id", userId).eq("status", "pending").order("created_at", { ascending: false }),
  ]);
  fail(own.error); fail(relations.error); fail(requests.error);
  const relationRows = (relations.data ?? []) as { id: string; user_a: string; user_b: string; created_at: string }[];
  const requestRows = (requests.data ?? []) as { id: string; sender_id: string; created_at: string }[];
  const profileIds = [...relationRows.map((row) => row.user_a === userId ? row.user_b : row.user_a), ...requestRows.map((row) => row.sender_id)];
  const profiles = await profilesByIds(client, profileIds);
  return {
    ownProfile: own.data ? profileFromRow(own.data as FriendProfileRow) : null,
    friends: relationRows.flatMap((row) => { const friendId = row.user_a === userId ? row.user_b : row.user_a; const friend = profiles.get(friendId); return friend ? [{ id: row.id, friend, createdAt: row.created_at }] : []; }),
    receivedRequests: requestRows.flatMap((row) => { const sender = profiles.get(row.sender_id); return sender ? [{ id: row.id, sender, createdAt: row.created_at }] : []; }),
  };
}

export async function saveFriendProfile(client: SupabaseClient, input: { userId: string; displayName: string; handle: string; searchEnabled: boolean }): Promise<void> {
  const handle = normalizeFriendHandle(input.handle);
  const validation = validateFriendHandle(handle);
  if (validation) throw new Error(validation);
  const result = await client.from("friend_profiles").upsert({ user_id: input.userId, display_name: input.displayName.trim(), handle, search_enabled: input.searchEnabled }, { onConflict: "user_id" });
  if (result.error?.code === "23505") throw new Error("Cet identifiant est déjà utilisé. Choisissez-en un autre.");
  fail(result.error);
}

export async function searchFriendProfiles(client: SupabaseClient, currentUserId: string, query: string): Promise<FriendProfile[]> {
  const handle = normalizeFriendHandle(query).replaceAll("%", "").replaceAll("_", "\\_");
  if (handle.length < 2) return [];
  const result = await client.from("friend_profiles").select("user_id,display_name,handle,search_enabled").eq("search_enabled", true).neq("user_id", currentUserId).ilike("handle", `${handle}%`).order("handle").limit(20);
  fail(result.error);
  return ((result.data ?? []) as FriendProfileRow[]).map(profileFromRow);
}

export async function sendFriendRequest(client: SupabaseClient, senderId: string, recipientId: string): Promise<void> {
  if (senderId === recipientId) throw new Error("Vous ne pouvez pas vous ajouter vous-même.");
  const result = await client.from("friend_requests").insert({ sender_id: senderId, recipient_id: recipientId, status: "pending" });
  fail(result.error);
}

async function callRequestRpc(client: SupabaseClient, functionName: string, parameter: string, id: string): Promise<void> {
  const result = await client.rpc(functionName, { [parameter]: id });
  fail(result.error);
}

export const acceptFriendRequest = (client: SupabaseClient, requestId: string) => callRequestRpc(client, "accept_friend_request", "p_request_id", requestId);
export const declineFriendRequest = (client: SupabaseClient, requestId: string) => callRequestRpc(client, "decline_friend_request", "p_request_id", requestId);
export const removeFriend = (client: SupabaseClient, friendshipId: string) => callRequestRpc(client, "revoke_friendship", "p_friendship_id", friendshipId);
