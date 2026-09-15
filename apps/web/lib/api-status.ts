import "server-only";

export type EndpointStatus = { available: boolean; checkedAt: string };

// Only the server reads this address. Credentials and upstream responses never
// enter the rendered page. No organization data is fetched by this public shell.
async function checkEndpoint(path: string): Promise<EndpointStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const base = process.env.API_INTERNAL_URL || "http://127.0.0.1:3001";
    const url = new URL(path, base);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { available: false, checkedAt };
    }
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
      redirect: "error",
    });
    return { available: response.ok, checkedAt };
  } catch {
    return { available: false, checkedAt };
  }
}

export async function getApiStatus() {
  const [health, readiness] = await Promise.all([
    checkEndpoint("/health"),
    checkEndpoint("/ready"),
  ]);
  return { health, readiness };
}
