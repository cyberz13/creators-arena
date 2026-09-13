/** Runs once at server start (Node runtime): fail closed on bad production config. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnv } = await import("./lib/env");
    assertProductionEnv();
  }
}
