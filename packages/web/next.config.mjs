/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel exposes its Git SHA during the build. Embedding it here keeps the
  // version route reliable even when system Git variables are not forwarded
  // to the deployed function runtime.
  env: {
    BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.BUILD_SHA
      || "unknown",
  },
};

export default nextConfig;
