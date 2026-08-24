#!/bin/sh
set -eu

config_path="${OPENCLAW_CONFIG_PATH:-${OPENCLAW_STATE_DIR:-/home/node/.openclaw}/openclaw.json}"
mkdir -p "$(dirname "$config_path")" "${OPENCLAW_WORKSPACE_DIR:-/home/node/.openclaw/workspace}"

if [ ! -s "$config_path" ]; then
  cp /app/openclaw.default.json "$config_path"
fi

if [ -n "${OPENCLAW_DEFAULT_MODEL:-}" ]; then
  OPENCLAW_BOOT_CONFIG="$config_path" node -e '
    const fs = require("fs");
    const path = process.env.OPENCLAW_BOOT_CONFIG;
    const config = JSON.parse(fs.readFileSync(path, "utf8"));
    config.agents ??= {};
    config.agents.defaults ??= {};
    config.agents.defaults.model = { primary: process.env.OPENCLAW_DEFAULT_MODEL };
    fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  '
fi

exec "$@"
