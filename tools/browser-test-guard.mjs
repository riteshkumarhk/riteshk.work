import { chromium } from "playwright-core";

const blockedHosts = ["*.workers.dev", "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com"];
const resolverRules = blockedHosts.map(host => "MAP " + host + " ~NOTFOUND").join(", ");
const launch = chromium.launch.bind(chromium);

chromium.launch = options => launch({
  ...options,
  args: [...(options?.args || []), "--no-proxy-server", "--host-resolver-rules=" + resolverRules]
});