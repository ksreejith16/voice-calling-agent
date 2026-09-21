import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      // Recover saved post-login destinations using the old sign-in spelling.
      // Dashboard authorization sends new users to onboarding and signed-out
      // visitors to the canonical /sign-in route.
      { source: "/signin", destination: "/dashboard", permanent: false },
    ];
  },
};

export default config;
