import { AgendaView } from "@/features/site/AgendaView";

export const metadata = { title: "Our agenda for Mombasa", description: "The plan for Mombasa County: what we will do and how.", robots: { index: true, follow: true } };

export default function AgendaPage() {
  return <AgendaView />;
}
