import JournalFlightGraphs from "../../../components/journal/JournalFlightGraphs";

export default async function JournalGraphsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalFlightGraphs flightId={id} initialFlight={null} />;
}
