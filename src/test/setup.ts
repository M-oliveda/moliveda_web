import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "framer-motion";
import { afterEach } from "vitest";

// Animations finish instantly in tests (MASTERPLAN section 7).
MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});
