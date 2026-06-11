#!/usr/bin/env bash
set -euo pipefail
CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/wechat-bridge-minimal"
STATE_DIR="${WECHAT_BRIDGE_STATE_DIR:-${CONFIG_DIR}/state}"
tail -n 200 -f "${STATE_DIR}/logs/service.out.log" "${STATE_DIR}/logs/service.err.log"
