"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "sonner";

import { TopLoader } from "@/components/loaders";
import { ServiceWorker } from "@/components/shell/ServiceWorker";
import { ConfirmProvider } from "@/components/ui/Confirm";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Don't retry what won't change (auth, validation, not-found).
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <TopLoader />
        <ServiceWorker />
        <ConfirmProvider>{children}</ConfirmProvider>
        <Toaster position="top-right" richColors closeButton toastOptions={{ className: "font-sans" }} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
