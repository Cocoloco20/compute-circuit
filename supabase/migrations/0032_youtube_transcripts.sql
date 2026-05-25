-- Migration: 0032_youtube_transcripts.sql
-- Add youtube_video_id and qna columns to transcript_signals, add youtube_channel to companies, and backfill.

-- 1. Alter transcript_signals table
alter table transcript_signals add column if not exists youtube_video_id text;
alter table transcript_signals add column if not exists qna_ai_mentions int;
alter table transcript_signals add column if not exists qna_gpu_mentions int;
alter table transcript_signals add column if not exists qna_capex_mentions int;
alter table transcript_signals add column if not exists qna_extracted_phrases jsonb default '[]'::jsonb;
alter table transcript_signals add column if not exists total_qna_words int;

-- 2. Alter companies table
alter table companies add column if not exists youtube_channel text;

-- 3. Backfill companies.youtube_channel for ~20 companies
update companies set youtube_channel = 'UCL-g3eGJi1omSDSz48AML-g' where id = 'nvda';
update companies set youtube_channel = 'UCnba_sSOe_umiHCpYYvRCqQ' where id = 'msft';
update companies set youtube_channel = 'UCnba_sSOe_umiHCpYYvRCqQ' where id = 'microsoft';
update companies set youtube_channel = 'UCK8sQmJBp8GCxrOtXWBpyEA' where id = 'googl';
update companies set youtube_channel = 'UCP7jMXSY2xbc3KCAE0MHQ-A' where id = 'deepmind';
update companies set youtube_channel = 'UCcr9tciZbuvJrEVAgIXCp8Q' where id = 'meta';
update companies set youtube_channel = 'UCcr9tciZbuvJrEVAgIXCp8Q' where id = 'meta-ai';
update companies set youtube_channel = 'UCxGq825hl0AHP18I9-JGKgg' where id = 'amzn';
update companies set youtube_channel = 'UC3IHCD51zFpt28TkSBOKJpA' where id = 'amd';
update companies set youtube_channel = 'UCtb_F21By-e-HD6uotM5nlA' where id = 'tsmc';
update companies set youtube_channel = 'UCxP5I5E0rTkBm71Mwn6lm0g' where id = 'asml';
update companies set youtube_channel = 'UCHUAckhCfRom2EHDGxwhfOg' where id = 'arm';
update companies set youtube_channel = 'UCZTvfJMhQ5Oc5TFw465tcJQ' where id = 'avgo';
update companies set youtube_channel = 'UC9G8DcGtPfHsVEfUTM_TjEw' where id = 'intc';
update companies set youtube_channel = 'UCHCThmyZ-2yWkv0UVeBDdnQ' where id = 'orcl';
update companies set youtube_channel = 'UChbeJruowh0XwPGHhJQK-5w' where id = 'crwv';
update companies set youtube_channel = 'UCkJ4UtX1ofCgENrFPR4DODA' where id = 'vrt';
update companies set youtube_channel = 'UC3Qh6YdzKgdaNfXhIBurkTA' where id = 'anet';
update companies set youtube_channel = 'UCXZCJLdBC09xxGZ6gcdrc6A' where id = 'openai';
update companies set youtube_channel = 'UCrDwWp7EBBv4NwvScIpBDOA' where id = 'anthropic';
