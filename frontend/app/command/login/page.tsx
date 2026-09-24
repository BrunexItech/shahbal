import { LoginScreen } from "@/components/auth/LoginScreen";

export const metadata = { title: "Command Centre sign-in" };

export default function CommandLoginPage() {
  return <LoginScreen portal="command" />;
}
