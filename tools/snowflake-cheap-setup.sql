-- Paste once in Snowsight on a *trial* account. Do not add a payment method.
-- X-Small + 60s auto-suspend: each resume bills at least ~1 minute (~0.017 credits).
-- Never enlarge this warehouse. Never click Upgrade.

ALTER WAREHOUSE COMPUTE_WH SET
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  STATEMENT_TIMEOUT_IN_SECONDS = 30;

SELECT CURRENT_ACCOUNT() AS account, CURRENT_WAREHOUSE() AS warehouse, CURRENT_VERSION() AS version;
