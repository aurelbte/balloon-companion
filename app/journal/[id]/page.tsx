import JournalFlightDetail from "../../components/journal/JournalFlightDetail";
import { getJournalFlight } from "../../lib/journalMockData";

export default async function JournalFlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalFlightDetail flightId={id} initialFlight={getJournalFlight(id)} />;
}
