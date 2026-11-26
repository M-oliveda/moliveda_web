import { z } from "zod";

// The CSP has no 'unsafe-eval', so Zod must never compile validators with
// `new Function` (MASTERPLAN section 3). Import `z` from this module only.
z.config({ jitless: true });

export { z };
