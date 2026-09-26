import { ContentPage } from "@/features/site/ContentPage";
import { CANDIDATE_NAME } from "@/lib/config";

export const metadata = { title: `About ${CANDIDATE_NAME}`, description: `Who ${CANDIDATE_NAME} is and why he is running for Governor of Mombasa.`, robots: { index: true, follow: true } };

export default function AboutPage() {
  return <ContentPage pageKey="about" eyebrow="About" lead={`${CANDIDATE_NAME} for Governor, Mombasa County.`} empty="This page is being written. Check back soon." />;
}
