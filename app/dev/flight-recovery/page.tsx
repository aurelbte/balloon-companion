import { notFound } from "next/navigation";
import FlightRecoveryWorkbench from "./FlightRecoveryWorkbench";

export default function FlightRecoveryPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <FlightRecoveryWorkbench />;
}
