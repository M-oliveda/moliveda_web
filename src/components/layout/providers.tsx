"use client";

import { LazyMotion, MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";

import type { FeatureBundle } from "framer-motion";
import type { ReactNode } from "react";

export type ProvidersProps = Readonly<{
  children: ReactNode;
}>;

/** Loads the `domAnimation` features after the first render. */
export async function loadMotionFeatures(): Promise<FeatureBundle> {
  const { motionFeatures } =
    await import("@/components/layout/motion-features");
  return motionFeatures;
}

/**
 * Client-side providers for every page: the `.dark` class theme
 * (`next-themes`) and animation settings that follow the visitor's
 * reduced-motion preference (MASTERPLAN 3, 4.2).
 */
export function Providers({ children }: ProvidersProps): React.JSX.Element {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <MotionConfig reducedMotion="user">
        <LazyMotion
          features={loadMotionFeatures}
          strict
        >
          {children}
        </LazyMotion>
      </MotionConfig>
    </ThemeProvider>
  );
}
