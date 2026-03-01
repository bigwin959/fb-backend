#!/usr/bin/env bash
# Exit on error
set -o errexit

npm install

# Rely on npm install's built-in postinstall hook for puppeteer to fetch Chrome
