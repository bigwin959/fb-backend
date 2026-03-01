#!/usr/bin/env bash
# Exit on error
set -o errexit

npm install

# Force Puppeteer to download Chrome using explicit JS script
node node_modules/puppeteer/install.mjs
