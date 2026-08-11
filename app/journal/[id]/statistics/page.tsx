import JournalFlightStatistics from "../../../components/journal/JournalFlightStatistics";

export default async function JournalStatisticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalFlightStatistics flightId={id} initialFlight={null} />;
}
