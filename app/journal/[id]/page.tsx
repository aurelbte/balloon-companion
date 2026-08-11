import JournalFlightDetail from "../../components/journal/JournalFlightDetail";

export default async function JournalFlightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalFlightDetail flightId={id} initialFlight={null} />;
}
