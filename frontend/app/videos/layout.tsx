import { CANDIDATE_NAME } from "@/lib/config";

export const metadata = { title: "Videos", description: `Rallies, town halls and interviews with ${CANDIDATE_NAME} across Mombasa. Newest first.`, robots: { index: true, follow: true } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
