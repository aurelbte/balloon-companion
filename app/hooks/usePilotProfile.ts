"use client";
import { useEffect, useState } from "react";
import { createEmptyPilotProfile } from "../lib/pilotProfile";
import { loadPilotProfile, PILOT_PROFILE_EVENT } from "../lib/pilotProfileStorage";
export function usePilotProfile() { const [profile, setProfile] = useState(createEmptyPilotProfile); useEffect(() => { const refresh = () => setProfile(loadPilotProfile()); const timer = window.setTimeout(refresh, 0); window.addEventListener("storage", refresh); window.addEventListener(PILOT_PROFILE_EVENT, refresh); return () => { window.clearTimeout(timer); window.removeEventListener("storage", refresh); window.removeEventListener(PILOT_PROFILE_EVENT, refresh); }; }, []); return profile; }
