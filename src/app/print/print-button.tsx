"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} type="button">
      <PrinterIcon data-icon="inline-start" />
      打印或另存为 PDF
    </Button>
  );
}
