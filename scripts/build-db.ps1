# Builds data/library.db from packages/ without starting the server.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
node "$Root/server.js" --build-db
