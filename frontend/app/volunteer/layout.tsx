import { CANDIDATE_NAME } from "@/lib/config";

export const metadata = { title: "Volunteer", description: `Volunteer with the ${CANDIDATE_NAME} campaign in your ward: door to door, events, polling agent and more.`, robots: { index: true, follow: true } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
