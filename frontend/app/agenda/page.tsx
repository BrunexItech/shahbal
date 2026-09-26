import { ContentPage } from "@/features/site/ContentPage";

export const metadata = { title: "Our agenda for Mombasa", description: "The plan for Mombasa County: what we will do and how.", robots: { index: true, follow: true } };

export default function AgendaPage() {
  return <ContentPage pageKey="agenda" eyebrow="Our agenda" lead="What we will do for Mombasa, shaped by what residents tell us." empty="The agenda is being finalised with residents' input. Tell us what matters in your area from the home page." />;
}
