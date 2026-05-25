-- Phase 5c backfill: companies.hf_org per the agent's verified mapping.
-- Case-sensitive — Intel/Groq/Oracle/CohereLabs use capitals, others lowercase.

update companies set hf_org = 'nvidia'           where id = 'nvda';
update companies set hf_org = 'amd'              where id = 'amd';
update companies set hf_org = 'arm'              where id = 'arm';
update companies set hf_org = 'qualcomm'         where id = 'qcom';
update companies set hf_org = 'Intel'            where id = 'intc';
update companies set hf_org = 'Groq'             where id = 'groq';
update companies set hf_org = 'cerebras'         where id = 'cerebras';
update companies set hf_org = 'sambanovasystems' where id = 'sambanova';

update companies set hf_org = 'meta-llama'       where id = 'meta-ai';
update companies set hf_org = 'google'           where id = 'googl';
update companies set hf_org = 'deepmind'         where id = 'deepmind';
update companies set hf_org = 'openai'           where id = 'openai';
update companies set hf_org = 'xai-org'          where id = 'xai';
update companies set hf_org = 'mistralai'        where id = 'mistral';
update companies set hf_org = 'CohereLabs'       where id = 'cohere';

update companies set hf_org = 'amazon'           where id = 'amzn';
update companies set hf_org = 'microsoft'        where id = 'msft';
update companies set hf_org = 'ibm-granite'      where id = 'ibm';
update companies set hf_org = 'Oracle'           where id = 'orcl';
update companies set hf_org = 'nebius'           where id = 'nbis';

-- 6 cos have HF orgs but 0 public models (avgo, mrvl, tenstorrent, anthropic,
-- crwv) or no canonical org (marvell). Left null — cron will skip them.
