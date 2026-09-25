import { redirect } from "next/navigation";

/** The Coverage Map now lives on the Command Centre (Visits view); keep old links working. */
export default function MapPage() {
  redirect("/dashboard");
}
