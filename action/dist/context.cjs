var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// action/src/context.ts
var context_exports = {};
__export(context_exports, {
  loadActionContext: () => loadActionContext,
  parsePullRequestPayload: () => parsePullRequestPayload
});
module.exports = __toCommonJS(context_exports);
var import_promises = require("node:fs/promises");
var SHA = /^[0-9a-f]{40}$/i;
function requiredSha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(`${label} must be a full 40-character Git SHA`);
  return value;
}
function parsePullRequestPayload(value) {
  if (!value || typeof value !== "object") throw new Error("GitHub event payload must be an object");
  const payload = value;
  const pr = payload.pull_request;
  if (!pr || typeof pr !== "object") throw new Error("Isotope requires a pull_request event or explicit base/head inputs");
  const fullName = payload.repository?.full_name;
  if (typeof fullName !== "string" || !fullName.includes("/")) throw new Error("GitHub repository owner/name is missing");
  const pullNumber = Number(payload.number);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error("Pull request number is invalid");
  const [owner, repo] = fullName.split("/", 2);
  return { owner, repo, pullNumber, baseSha: requiredSha(pr.base?.sha, "pull_request.base.sha"), headSha: requiredSha(pr.head?.sha, "pull_request.head.sha"), actor: String(payload.sender?.login ?? "") };
}
async function loadActionContext(inputs) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    const payload = JSON.parse(await (0, import_promises.readFile)(eventPath, "utf8"));
    if (payload.pull_request) return parsePullRequestPayload(payload);
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!inputs.base || !inputs.head || !repository?.includes("/")) throw new Error("Outside pull_request events, provide base and head inputs and GITHUB_REPOSITORY");
  const pullNumber = Number(inputs.pullNumber);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error("Explicit pr-number is required for reporting");
  const [owner, repo] = repository.split("/", 2);
  return { owner, repo, pullNumber, baseSha: requiredSha(inputs.base, "base"), headSha: requiredSha(inputs.head, "head"), actor: process.env.GITHUB_ACTOR ?? "" };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  loadActionContext,
  parsePullRequestPayload
});
