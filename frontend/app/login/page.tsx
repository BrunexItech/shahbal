"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { BrandLoader } from "@/components/loaders";
import { lastPortal, PORTAL_LOGIN } from "@/lib/portal";

/** Legacy /login: forward to the portal this device last used (field by default). */
export default function LoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`${PORTAL_LOGIN[lastPortal()]}${window.location.search}`);
  }, [router]);
  return <BrandLoader message="Opening sign-in" />;
}
