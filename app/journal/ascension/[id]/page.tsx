import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import NavigationBar from "../../../components/NavigationBar";
import CompletionAscensionDetail from "../../../components/journal/CompletionAscensionDetail";
import styles from "../../Journal.module.css";

export default async function AscensionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <Link href="/journal" className={styles.backLink}><ChevronLeft size={18} aria-hidden="true" /> Carnet</Link>
        <CompletionAscensionDetail ascensionId={id} />
      </div>
      <NavigationBar activeItem="Journal" />
    </main>
  );
}
