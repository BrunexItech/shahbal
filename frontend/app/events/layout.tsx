import { CANDIDATE_NAME } from "@/lib/config";

export const metadata = { title: "Events", description: `Upcoming rallies, town halls and community meetings with ${CANDIDATE_NAME} across Mombasa.`, robots: { index: true, follow: true } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
