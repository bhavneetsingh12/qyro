const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");

module.exports = {
  apps: [
    {
      name: "qyro-api",
      cwd: repoRoot,
      script: "pnpm",
      args: "--filter @qyro/api start",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "qyro-research-worker",
      cwd: repoRoot,
      script: "pnpm",
      args: "--filter @qyro/workers worker:research",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "qyro-outreach-worker",
      cwd: repoRoot,
      script: "pnpm",
      args: "--filter @qyro/workers worker:outreach",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "qyro-outbound-call-worker",
      cwd: repoRoot,
      script: "pnpm",
      args: "--filter @qyro/queue worker:outbound-call",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
