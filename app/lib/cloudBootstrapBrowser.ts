import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuntimeDataScope } from "./auth/dataScopeRuntime.ts";
import { CloudBootstrapService } from "./cloudBootstrapService.ts";
import {
  createBrowserBalloonPullService,
  createBrowserDocumentPullService,
  createBrowserFavoriteLaunchSitePullService,
  createBrowserFavoriteWeatherPlacePullService,
  createBrowserFlightPullService,
  createBrowserLogbookEntryPullService,
  createBrowserPilotProfilePullService,
  createBrowserPreferencePullService,
} from "./cloudPullBrowser.ts";
import { IndexedDbSyncOutboxStorage } from "./syncOutbox.ts";

export function createBrowserCloudBootstrapService(input: Readonly<{
  client: SupabaseClient;
  storage: Storage;
  scope: `USER:${string}`;
}>): CloudBootstrapService {
  const preferences = createBrowserPreferencePullService(input);
  const profile = createBrowserPilotProfilePullService(input);
  const favoriteWeatherPlaces = createBrowserFavoriteWeatherPlacePullService(input);
  const favoriteLaunchSites = createBrowserFavoriteLaunchSitePullService(input);
  const balloons = createBrowserBalloonPullService(input);
  const flights = createBrowserFlightPullService(input);
  const logbookEntries = createBrowserLogbookEntryPullService(input);
  const documents = createBrowserDocumentPullService(input);
  const outbox = new IndexedDbSyncOutboxStorage(input.scope);
  return new CloudBootstrapService({
    scope: input.scope,
    getScope: getRuntimeDataScope,
    getOnlineUserId: async () => {
      const { data, error } = await input.client.auth.getUser();
      if (error) throw new Error("Cloud bootstrap auth unavailable");
      return data.user?.id ?? null;
    },
    isOnline: () => typeof navigator !== "undefined" && navigator.onLine,
    listOutbox: () => outbox.list(),
    pulls: {
      profile: () => profile.pullPilotProfile(),
      pilotQualifications: () => preferences.pullPilotQualifications(),
      unitPreferences: () => preferences.pullUnitPreferences(),
      weatherPreferences: () => preferences.pullWeatherPreferences(),
      aviationPreferences: () => preferences.pullAviationPreferences(),
      favoriteWeatherPlaces: () => favoriteWeatherPlaces.pullFavoriteWeatherPlaces(),
      favoriteLaunchSites: () => favoriteLaunchSites.pullFavoriteLaunchSites(),
      balloons: () => balloons.pullBalloons(),
      balloonPreferences: () => preferences.pullBalloonPreferences(),
      flights: () => flights.pullFlights(),
      logbookEntries: () => logbookEntries.pullLogbookEntries(),
      documents: () => documents.pullDocuments(),
    },
    now: () => new Date().toISOString(),
  });
}
