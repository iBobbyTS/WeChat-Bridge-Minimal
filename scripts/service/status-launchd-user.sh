#!/usr/bin/env bash
set -euo pipefail
LABEL="${LABEL:-com.ibobby.wechat-bridge-minimal}"
launchctl print "gui/${UID}/${LABEL}"
