"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--jp-card)",
          "--normal-text": "var(--jp-fg)",
          "--normal-border": "var(--jp-outline)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
