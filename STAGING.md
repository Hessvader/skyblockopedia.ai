# Staging environment

`main` → **production** → https://skyblockopedia.com (and skyblockopedia-ai.vercel.app)

`staging` → **preview** → auto-built by Vercel at a stable branch URL:
`https://skyblockopedia-ai-git-staging-hessvaders-projects.vercel.app`

## Workflow

1. Commit/upload changes to the **`staging`** branch first.
2. Vercel auto-builds the preview. Test it at the staging URL above.
3. When it looks good, merge `staging` → `main` (or upload to `main`) to ship to production.

All environment variables (Hypixel key, KV, Resend, AI keys) are scoped to
"Production and Preview", so staging behaves exactly like production.
