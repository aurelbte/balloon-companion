import { notFound } from "next/navigation";
import BcFlightImporter from "./BcFlightImporter";

export default function BcFlightDebugPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BcFlightImporter />;
}
