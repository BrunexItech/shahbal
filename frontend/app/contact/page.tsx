import { ContentPage } from "@/features/site/ContentPage";

export const metadata = { title: "Contact the campaign", description: "How to reach the campaign team.", robots: { index: true, follow: true } };

export default function ContactPage() {
  return <ContentPage pageKey="contact" eyebrow="Contact" lead="Reach the campaign team." empty="Contact details are coming soon. Meanwhile, you can report an issue or join the team from the home page." />;
}
