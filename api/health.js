// api/health.js
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  return res.status(200).json({
    ok: true,
    service: "readr-api",
    marker: "rank-debug-2026-05-02-001",
    env: process.env.VERCEL_ENV || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    url: process.env.VERCEL_URL || null,
    now: new Date().toISOString()
  });
}