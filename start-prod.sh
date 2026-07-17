#!/bin/bash
export PATH="$HOME/.local/bin:$PATH"
eval "$(fnm env --use-on-cd)"
cd "$(dirname "$0")/cli/app"
exec node server.js
