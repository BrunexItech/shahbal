import { CANDIDATE_NAME } from "@/lib/config";

export const metadata = { title: "News", description: `Latest news from the campaign of ${CANDIDATE_NAME} for Governor of Mombasa.`, robots: { index: true, follow: true } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
