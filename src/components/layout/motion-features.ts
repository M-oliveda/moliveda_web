import { domAnimation } from "framer-motion";

// Loaded on demand by `LazyMotion`, so animation code stays out of the
// initial bundle (framer-motion docs, "Reduce bundle size").
export const motionFeatures = domAnimation;
