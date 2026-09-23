import { PageHeader } from "@/components/ui";
import { VoterWizard } from "@/features/voters/components/VoterWizard";

export const metadata = { title: "Capture voter" };

export default function CaptureVoterPage() {
  return (
    <>
      <PageHeader eyebrow="Field capture" title="Capture a voter" subtitle="Four quick steps. Your progress is saved on this device until you submit." />
      <VoterWizard />
    </>
  );
}
