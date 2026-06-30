#!/usr/bin/env node

import { readFileSync } from "node:fs";

function formatTokens(value, kilo = "k") {
  const tokens = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (tokens >= 1_000_000) {
    return `${Math.trunc(tokens / 1_000_000)}.${Math.trunc((tokens % 1_000_000) / 100_000)}M`;
  }
  if (tokens >= 1_000) return `${Math.trunc(tokens / 1_000)}${kilo}`;
  return String(tokens);
}

const input = JSON.parse(readFileSync(0, "utf8"));
const contextPercent = input.context?.percent == null ? "?" : Math.round(input.context.percent);
const modelName = input.model?.name || input.model?.id || "unknown-model";
const reasoning = input.model?.reasoning && input.thinkingLevel
  ? `${input.thinkingLevel} • `
  : "";

process.stdout.write(
  `${contextPercent}% | ↑${formatTokens(input.usage?.input)} ↓${formatTokens(input.usage?.output)}`
  + ` | ${formatTokens(input.usage?.totalTokens, "K")}  (${Math.round(input.usage?.cacheHitPercent || 0)}%)`
  + ` | ${modelName} • ${reasoning}${formatTokens(input.context?.contextWindow, "K")}\n`,
);

const cwd = input.session?.cwd || process.cwd();
const branch = input.git?.branch;
process.stdout.write(branch ? `${cwd} | ${branch}\n` : `${cwd}\n`);
