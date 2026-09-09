import { NextResponse } from 'next/server'

/**
 * What is actually live right now.
 *
 * Deploys were being confirmed by sleeping and hoping. That is how a stale
 * server got tested for three cycles earlier in this project, and how a deploy
 * was once reported READY by matching on state instead of commit. Vercel bakes
 * the commit into the build, so the running server can just say which commit it
 * is, and `scripts/ship.sh` polls this until the SHA it pushed comes back —
 * no fixed waits, no guessing.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
    env: process.env.VERCEL_ENV ?? 'development',
    builtAt: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  })
}
