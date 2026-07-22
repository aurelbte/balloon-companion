/**
 * Flight Storage - Local Storage Management for Balloon Companion
 * Gère la persistance des données de vol en préparation
 */

/**
 * Interface représentant les données d'un vol en préparation
 */
export interface Flight {
  terrain: string;
  date: string;
  heure: string;
  duree: string;
  ballon: string;
  meteo: string;
  createdAt?: number;
  updatedAt?: number;
}

const STORAGE_KEY = "balloon_companion_flight";

/**
 * Sauvegarde le vol en cours dans le localStorage
 * @param flight - Les données du vol à sauvegarder
 * @returns true si la sauvegarde a réussi, false sinon
 */
export function saveCurrentFlight(flight: Flight): boolean {
  try {
    const flightWithTimestamp: Flight = {
      ...flight,
      updatedAt: Date.now(),
      createdAt: flight.createdAt || Date.now(),
    };

    const serialized = JSON.stringify(flightWithTimestamp);
    localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (error) {
    console.error("Erreur lors de la sauvegarde du vol:", error);
    return false;
  }
}

/**
 * Récupère le vol en cours depuis le localStorage
 * @returns Les données du vol en cours, ou null si aucun vol n'existe
 */
export function getCurrentFlight(): Flight | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const flight = JSON.parse(stored) as Flight;
    return flight;
  } catch (error) {
    console.error("Erreur lors de la lecture du vol:", error);
    return null;
  }
}

/**
 * Efface le vol en cours du localStorage
 * @returns true si l'effacement a réussi, false sinon
 */
export function clearCurrentFlight(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (error) {
    console.error("Erreur lors de l'effacement du vol:", error);
    return false;
  }
}
