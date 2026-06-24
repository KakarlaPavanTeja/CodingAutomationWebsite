"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PipelinePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/problems/new");
  }, [router]);

  return null;
}
