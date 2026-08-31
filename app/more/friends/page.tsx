"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import NavigationBar from "../../components/NavigationBar";
import { useBalloonAuth } from "../../contexts/AuthContext";
import { usePilotProfile } from "../../hooks/usePilotProfile";
import {
  acceptFriendRequest,
  declineFriendRequest,
  friendOnboardingDefaults,
  loadFriendsSnapshot,
  normalizeFriendHandle,
  prefillFriendIdentityField,
  removeFriend,
  saveFriendProfile,
  searchFriendProfiles,
  sendFriendRequest,
  validateFriendHandle,
  type FriendProfile,
  type FriendsSnapshot,
} from "../../lib/friends";
import { createBrowserSupabaseClient } from "../../lib/supabase/client";
import styles from "./Friends.module.css";

const EMPTY_SNAPSHOT: FriendsSnapshot = { ownProfile: null, friends: [], receivedRequests: [], pendingSentRecipientIds: [] };

export default function FriendsPage() {
  const auth = useBalloonAuth();
  const pilotProfile = usePilotProfile();
  const userId = auth.user?.id ?? null;
  const [snapshot, setSnapshot] = useState<FriendsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendProfile[]>([]);
  const displayNameEditedRef = useRef(false);
  const handleEditedRef = useRef(false);
  const actionBusyRef = useRef(false);

  const refresh = useCallback(async (expectedUserId: string) => {
    const next = await loadFriendsSnapshot(createBrowserSupabaseClient(), expectedUserId);
    if (auth.user?.id === expectedUserId) setSnapshot(next);
  }, [auth.user?.id]);

  useEffect(() => {
    setSnapshot(EMPTY_SNAPSHOT);
    setResults([]);
    setError(null);
    setDisplayName("");
    setHandle("");
    displayNameEditedRef.current = false;
    handleEditedRef.current = false;
    if (auth.state !== "SIGNED_IN" || !userId) return;
    let active = true;
    setLoading(true);
    void loadFriendsSnapshot(createBrowserSupabaseClient(), userId)
      .then((next) => {
        if (!active || auth.user?.id !== userId) return;
        setSnapshot(next);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Chargement indisponible."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [auth.state, auth.user?.firstName, auth.user?.id, auth.user?.lastName, userId]);

  useEffect(() => {
    if (snapshot.ownProfile) return;
    const defaults = friendOnboardingDefaults({
      authFirstName: auth.user?.firstName ?? "",
      authLastName: auth.user?.lastName ?? "",
      profileFirstName: pilotProfile.firstName,
      profileLastName: pilotProfile.lastName,
    });
    setDisplayName((current) => prefillFriendIdentityField(current, defaults.displayName, displayNameEditedRef.current));
    setHandle((current) => prefillFriendIdentityField(current, defaults.handle, handleEditedRef.current));
  }, [auth.user?.firstName, auth.user?.lastName, pilotProfile.firstName, pilotProfile.lastName, snapshot.ownProfile]);

  async function run(id: string, action: () => Promise<void>) {
    if (!userId || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setBusyId(id); setError(null);
    try { await action(); await refresh(userId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Action impossible."); }
    finally { actionBusyRef.current = false; setBusyId(null); }
  }

  async function createProfile(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    const validation = validateFriendHandle(handle);
    if (validation) { setError(validation); return; }
    await run("profile", () => saveFriendProfile(createBrowserSupabaseClient(), { userId, displayName, handle, searchEnabled }));
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setBusyId("search"); setError(null);
    try { setResults(await searchFriendProfiles(createBrowserSupabaseClient(), userId, query)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Recherche indisponible."); }
    finally { setBusyId(null); }
  }

  if (auth.state !== "SIGNED_IN" || !userId) return <main className={styles.screen}><div className={styles.layout}><Link href="/more" className={styles.back}><ChevronLeft size={18} /> Plus</Link><header><p className={styles.eyebrow}>Balloon Companion</p><h1 className={styles.title}>Amis</h1></header><section className={styles.section}><p className={styles.empty}>Connectez-vous pour utiliser les amis Balloon Companion.</p></section></div><NavigationBar activeItem="Plus" /></main>;

  return <main className={styles.screen}><div className={styles.layout}>
    <Link href="/more" className={styles.back}><ChevronLeft size={18} /> Plus</Link>
    <header><p className={styles.eyebrow}>Balloon Companion</p><h1 className={styles.title}>Amis</h1><p className={styles.intro}>Retrouvez d’autres pilotes sans partager votre adresse email.</p></header>
    {loading ? <section className={styles.section}><p className={styles.status}>Chargement…</p></section> : !snapshot.ownProfile ? <section className={styles.section}><h2>Choisir mon identifiant</h2><p className={styles.hint}>Votre identifiant public permettra à vos amis de vous retrouver.</p><form className={styles.form} onSubmit={(event) => void createProfile(event)}><label><span>Nom affiché</span><input value={displayName} maxLength={80} required onChange={(event) => { displayNameEditedRef.current = true; setDisplayName(event.target.value); }} /></label><label><span>Identifiant</span><input value={handle} minLength={3} maxLength={30} autoCapitalize="none" autoCorrect="off" placeholder="ex. pilote.nom" required onChange={(event) => { handleEditedRef.current = true; setHandle(normalizeFriendHandle(event.target.value)); }} /></label><label className={styles.check}><input type="checkbox" checked={searchEnabled} onChange={(event) => setSearchEnabled(event.target.checked)} /> Autoriser les autres pilotes à me trouver avec mon identifiant</label><button className={styles.primary} disabled={busyId !== null} type="submit">Créer mon profil Amis</button></form></section> : <>
      <section className={styles.section}><h2>Ajouter un ami</h2><p className={styles.hint}>Recherchez uniquement son identifiant Balloon Companion.</p><form className={styles.search} onSubmit={(event) => void search(event)}><input aria-label="Identifiant à rechercher" value={query} autoCapitalize="none" autoCorrect="off" placeholder="@identifiant" onChange={(event) => setQuery(event.target.value)} /><button disabled={busyId !== null || query.trim().length < 2} type="submit">Rechercher</button></form>{results.length > 0 && <div className={styles.list}>{results.map((profile) => { const pending = snapshot.pendingSentRecipientIds.includes(profile.userId); return <div className={styles.row} key={profile.userId}><div className={styles.identity}><strong>{profile.displayName}</strong><span>@{profile.handle}</span></div><button className={styles.action} disabled={busyId !== null || pending} type="button" onClick={() => void run(profile.userId, () => sendFriendRequest(createBrowserSupabaseClient(), userId, profile.userId))}>{pending ? "En attente de réponse" : "Ajouter"}</button></div>; })}</div>}</section>
      <section className={styles.section}><h2>Demandes reçues</h2>{snapshot.receivedRequests.length === 0 ? <p className={styles.empty}>Aucune demande en attente.</p> : <div className={styles.list}>{snapshot.receivedRequests.map((request) => <div className={styles.row} key={request.id}><div className={styles.identity}><strong>{request.sender.displayName}</strong><span>@{request.sender.handle}</span></div><div className={styles.actions}><button className={styles.action} disabled={busyId !== null} type="button" onClick={() => void run(request.id, () => acceptFriendRequest(createBrowserSupabaseClient(), request.id))}>Accepter</button><button className={`${styles.action} ${styles.danger}`} disabled={busyId !== null} type="button" onClick={() => void run(request.id, () => declineFriendRequest(createBrowserSupabaseClient(), request.id))}>Refuser</button></div></div>)}</div>}</section>
      <section className={styles.section}><h2>Mes amis</h2>{snapshot.friends.length === 0 ? <p className={styles.empty}>Aucun ami pour le moment.</p> : <div className={styles.list}>{snapshot.friends.map((friendship) => <div className={styles.row} key={friendship.id}><div className={styles.identity}><strong>{friendship.friend.displayName}</strong><span>@{friendship.friend.handle}</span></div><button className={`${styles.action} ${styles.danger}`} disabled={busyId !== null} type="button" onClick={() => void run(friendship.id, () => removeFriend(createBrowserSupabaseClient(), friendship.id))}>Supprimer</button></div>)}</div>}</section>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section className={`${styles.section} ${styles.comingSoon}`}><h2>Partage de vol en direct</h2><span>Bientôt disponible</span></section>
  </div><NavigationBar activeItem="Plus" /></main>;
}
