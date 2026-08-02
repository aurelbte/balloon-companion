import JournalFlightGraphs from "../../../components/journal/JournalFlightGraphs";
import { getJournalFlight } from "../../../lib/journalMockData";

export default async function JournalGraphsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalFlightGraphs flightId={id} initialFlight={getJournalFlight(id)} />;
}
