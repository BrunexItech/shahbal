import { LoginScreen } from "@/components/auth/LoginScreen";

export const metadata = { title: "Field team sign-in" };

export default function FieldLoginPage() {
  return <LoginScreen portal="field" />;
}
