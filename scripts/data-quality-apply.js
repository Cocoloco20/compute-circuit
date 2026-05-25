// Compute Circuit — apply data quality fixes
// Run: node scripts/data-quality-apply.js
//
// Decisions (see data-quality-audit.js output and HANDOFF.md for rationale):
//
// MERGES (1 — high confidence only)
//   vast-ai  <- absorbs vastai           [keep: vast-ai (w=11) | drop: vastai (w=3)]
//                                        same domain (vast.ai), same name (Vast.ai),
//                                        Levenshtein=1. vast-ai has full thesis + flow link.
//
// RENAMES (4)
//   easic-corp.name        : 'EASIC CORP'   -> 'eASIC Corporation'   (canonical brand)
//   nvda.name              : 'NVIDIA'       -> 'NVIDIA Corporation'  (canonical brand)
//   sumco.name             : 'SUMCO'        -> 'SUMCO Corporation'   (canonical brand)
//   arm.hf_org             : 'arm'          -> 'Arm'                 (real HF org slug)
//
// FOREIGN-KEY REASSIGNMENT (for vastai->vast-ai merge)
// vastai had rows in:  job_snapshots(1), social_mentions(2). Others were empty.
// social_mentions has unique(company_id, snapshot_date, source) and both rows are
// duplicates of vast-ai's existing rows -> delete vastai's duplicates first.
// job_snapshots has unique(company_id, snapshot_date) and vast-ai has zero rows
// -> safe to reassign.
// flows is polymorphic (text from_id/to_id) — vastai had 0.
//
// FLAGGED FOR USER REVIEW (no action — user decides)
//   - seamicro-inc:  defunct since 2015 (acquired by AMD 2012); has 8 stale signals
//                    + 1 backer. Likely name-collision in news scraper.
//   - nirvanix-inc:  defunct since 2013; 0 activity in 1500d+. No signals/jobs.
//   - easic-corp:    defunct since 2018 (acquired by Intel); 1 stale signal at ~385d.
//                    Renamed for clarity but kept (Khosla portfolio history).
//   - xai.assignee_name: confirmed null is correct. Tried 11 variants
//                    (X.AI Corp, X.AI Corp., XAI, xAI, X.AI LLC, ...); xAI was
//                    founded mid-2023 so most patent apps haven't published yet.
//                    'XAI' matches an unrelated 'MINED XAI LLC'. Leaving unset.
//
const { Client } = require('pg')
require('dotenv').config({ path: '/Users/luiguisanchez/compute-circuit/.env.local' })

;(async () => {
  const u = new URL(process.env.DATABASE_URL)
  const password = decodeURIComponent(u.password)
  const c = new Client({
    host: 'aws-1-us-west-1.pooler.supabase.com', port: 5432,
    user: 'postgres.moeqxxsmksjdayaeblit', password, database: 'postgres',
    ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 6000,
  })
  await c.connect()

  const n = { merge: 0, delete: 0, rename: 0, reassign: 0, dedup_drop: 0 }

  await c.query('BEGIN')
  try {
    // ====== RENAMES ======
    console.log('--- RENAMES ---')

    {
      const r = await c.query(
        `UPDATE companies SET name = 'eASIC Corporation' WHERE id = 'easic-corp' AND name = 'EASIC CORP';`
      )
      console.log(`  easic-corp.name = 'eASIC Corporation' (${r.rowCount} row)`)
      n.rename += r.rowCount
    }
    {
      const r = await c.query(
        `UPDATE companies SET name = 'NVIDIA Corporation' WHERE id = 'nvda' AND name = 'NVIDIA';`
      )
      console.log(`  nvda.name = 'NVIDIA Corporation' (${r.rowCount} row)`)
      n.rename += r.rowCount
    }
    {
      const r = await c.query(
        `UPDATE companies SET name = 'SUMCO Corporation' WHERE id = 'sumco' AND name = 'SUMCO';`
      )
      console.log(`  sumco.name = 'SUMCO Corporation' (${r.rowCount} row)`)
      n.rename += r.rowCount
    }
    {
      const r = await c.query(
        `UPDATE companies SET hf_org = 'Arm' WHERE id = 'arm' AND hf_org = 'arm';`
      )
      console.log(`  arm.hf_org = 'Arm' (${r.rowCount} row)`)
      n.rename += r.rowCount
    }

    // ====== MERGE: vastai -> vast-ai ======
    console.log('\n--- MERGE: vastai -> vast-ai ---')

    // social_mentions: vast-ai already has rows for the same (snapshot_date, source) tuples.
    // Delete vastai's duplicate rows first so the subsequent reassignment doesn't trip the
    // unique index. (vast-ai's rows have slightly higher top_post_score — keep them as-is.)
    {
      const r = await c.query(`
        DELETE FROM social_mentions a
        WHERE a.company_id = 'vastai'
          AND EXISTS (
            SELECT 1 FROM social_mentions b
            WHERE b.company_id = 'vast-ai'
              AND b.snapshot_date = a.snapshot_date
              AND b.source = a.source
          );
      `)
      console.log(`  dedup-drop social_mentions vastai duplicates (${r.rowCount} rows)`)
      n.dedup_drop += r.rowCount
    }

    // Now reassign anything remaining on vastai across every child table.
    // Most are zero-row (vastai is small) — these are no-ops but documented for traceability.
    for (const tbl of [
      // FK tables (CASCADE on most, SET NULL on holdings/leaderboard)
      'signal_companies', 'holdings', 'company_backers', 'patent_snapshots',
      'hf_activity', 'insider_transactions', 'github_activity', 'transcript_signals',
      'grid_demand_snapshots', 'bottleneck_beneficiaries', 'fundamentals',
      'model_leaderboard', 'funding_rounds', 'social_mentions', 'job_snapshots',
    ]) {
      const r = await c.query(
        `UPDATE ${tbl} SET company_id = 'vast-ai' WHERE company_id = 'vastai';`
      )
      if (r.rowCount > 0) {
        console.log(`  reassign ${tbl} vastai->vast-ai (${r.rowCount} rows)`)
        n.reassign += r.rowCount
      }
    }

    // Reassign polymorphic flows (no FK; just text columns)
    {
      const r1 = await c.query(
        `UPDATE flows SET from_id = 'vast-ai' WHERE from_id = 'vastai' AND from_kind = 'company';`
      )
      const r2 = await c.query(
        `UPDATE flows SET to_id = 'vast-ai' WHERE to_id = 'vastai' AND to_kind = 'company';`
      )
      if (r1.rowCount + r2.rowCount > 0) {
        console.log(`  reassign flows vastai->vast-ai (from=${r1.rowCount}, to=${r2.rowCount})`)
        n.reassign += r1.rowCount + r2.rowCount
      }
    }

    // Finally delete the dup row.
    {
      const r = await c.query(`DELETE FROM companies WHERE id = 'vastai';`)
      console.log(`  DELETE companies WHERE id='vastai' (${r.rowCount} row)`)
      n.delete += r.rowCount
      n.merge += 1
    }

    await c.query('COMMIT')
    console.log('\n--- COMMITTED ---')
    console.log(`  merges:     ${n.merge}`)
    console.log(`  deletes:    ${n.delete}`)
    console.log(`  renames:    ${n.rename}`)
    console.log(`  reassigns:  ${n.reassign}`)
    console.log(`  dedup-drops:${n.dedup_drop}`)
  } catch (e) {
    await c.query('ROLLBACK')
    console.error('ROLLBACK due to error:', e.message)
    throw e
  } finally {
    await c.end()
  }
})().catch(e => { console.error('FATAL', e); process.exit(1) })
