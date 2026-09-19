-- 1) If Snowsight still works, UNSET first so you are not locked out.
USE ROLE ACCOUNTADMIN;
ALTER ACCOUNT UNSET NETWORK_POLICY;
ALTER USER rbadal1 UNSET NETWORK_POLICY;

-- 2) Confirm you can still query:
SELECT CURRENT_USER(), CURRENT_ROLE();

-- 3) Recreate with a network *rule* (allowed list on the policy was empty/wrong).
CREATE NETWORK RULE IF NOT EXISTS isotope_home_ip
  TYPE = IPV4
  VALUE_LIST = ('128.220.159.221/32')
  MODE = INGRESS;

CREATE NETWORK POLICY IF NOT EXISTS isotope_pat_policy;
ALTER NETWORK POLICY isotope_pat_policy SET ALLOWED_NETWORK_RULE_LIST = ('isotope_home_ip');

-- 4) Attach to the user only (safer than locking the whole account).
ALTER USER rbadal1 SET NETWORK_POLICY = isotope_pat_policy;

DESC NETWORK POLICY isotope_pat_policy;
DESC USER rbadal1;
