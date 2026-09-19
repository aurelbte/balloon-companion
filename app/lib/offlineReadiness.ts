export async function serviceWorkerRegistrationReadiness(
  registration: Pick<ServiceWorkerRegistration, "active" | "installing" | "waiting">,
): Promise<"READY" | "FAILED"> {
  if (registration.active || registration.waiting) return "READY";
  const worker = registration.installing;
  if (!worker) return "FAILED";
  if (worker.state === "activated" || worker.state === "installed") return "READY";
  if (worker.state === "redundant") return "FAILED";
  return new Promise((resolve) => {
    const changed = () => {
      if (worker.state === "activated" || worker.state === "installed") {
        worker.removeEventListener("statechange", changed);
        resolve("READY");
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", changed);
        resolve("FAILED");
      }
    };
    worker.addEventListener("statechange", changed);
  });
}
