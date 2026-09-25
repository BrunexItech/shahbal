import JoinPage from "@/app/join/page";
import { CAMPAIGN_NAME, CANDIDATE_NAME } from "@/lib/config";

/**
 * The home address is the public supporter sign-up: that's who arrives at the bare
 * domain. Staff use their own doors, /command/login (HQ) and /field/login (field).
 */
export const metadata = {
  title: `Join ${CAMPAIGN_NAME} · ${CANDIDATE_NAME} for Mombasa`,
  description: `Sign up to support ${CANDIDATE_NAME} for Mombasa: know when the team visits your ward and get a reminder on voting day.`,
};

export default function Home() {
  return <JoinPage />;
}
