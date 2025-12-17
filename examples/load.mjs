import { loadColony } from "../src/index.js";

process.env.REALM = process.env.REALM || "US";

const cfg = await loadColony({
  entry: new URL("./config/app.colony", import.meta.url).pathname,
  dims: ["env", "realm", "region"],
  ctx: { env: "prod", realm: "US", region: "us-east-1" },
  vars: { ROOT: process.cwd() },
});

console.log("precompute.aws.region:", cfg.get("precompute.aws.region"));
console.log("endpoint:", cfg.get("precompute.dynamodb.endpoint"));
console.log("interceptors:", cfg.get("bsfclient.defaultInterceptors"));
console.log("explain(precompute.aws.region):", cfg.explain("precompute.aws.region"));
