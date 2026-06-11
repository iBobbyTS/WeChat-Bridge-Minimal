#!/usr/bin/env bash
set -euo pipefail
LABEL="${LABEL:-com.ibobby.wechat-bridge-minimal}"
launchctl kickstart -k "gui/${UID}/${LABEL}"
