const path = require("path");

const repoRoot = path.resolve(__dirname, "../..");

module.exports = {
  apps: [
    {
      name: "qyro-api",
      cwd: repoRoot,
      script: "pnpm",
      args: "--filter @qyro/api dev",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "qyro-research-worker",
      cwd: repoRoot,
      script: "pnpm",
      args: "--filter @qyro/queue worker:research",
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
