import { CAMPAIGN_NAME } from "@/lib/config";

export const metadata = { title: "Join the movement", description: `Sign up to stay informed by ${CAMPAIGN_NAME}.` };

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
