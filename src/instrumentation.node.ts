import { EnvValidationError, getEnv } from "@/lib/env";

// Fail closed (MASTERPLAN 4.7): refuse to start with an invalid configuration.
// Next.js only logs errors thrown from `register`, so exit explicitly. The
// message lists key names only, never values.
try {
  getEnv();
} catch (error) {
  const message =
    error instanceof EnvValidationError
      ? error.message
      : "Environment validation failed";
  console.error(JSON.stringify({ severity: "CRITICAL", message }));
  process.exit(1);
}
