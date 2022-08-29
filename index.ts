import { Agent } from "./Agent";
import { Logger } from "./Logger";
import { isWorker } from "./utils";

declare global {
  var CONSTANTS : {
    IS_PROD: boolean;
    VERSION: string;
  }
}

const sdk = {

  __agent: null,

  version: CONSTANTS.VERSION,

  install: (options: RM.InstallOptions) => {
    try {
      if (sdk.__agent) {
        console.warn("Request Metrics is already installed.");
        return;
      }

      if (!options || !options.token) {
        console.error("You must provide a token to install Request Metrics.")
        return;
      }

      Logger.token = options.token;

      sdk.__agent = new Agent(options);
    }
    catch (e) {
      Logger.error(e);
    }
  }
}

export const version = sdk.version;
export var install = sdk.install;

// Try to automatically install the agent for the default use case
(function () {
  try {
    if (isWorker()) { return; }

    var scriptEl = document.querySelector("[data-rm-token]");
    if (!scriptEl) { return; }

    var token = scriptEl.getAttribute("data-rm-token");
    if (!token) { return; }

    Logger.token = token;

    sdk.install({
      token: token,
      ingestUrl: scriptEl.getAttribute("data-rm-ingest"),
      monitorSelfCalls: !!scriptEl.getAttribute("data-rm-monitor-self")
    });
  }
  catch (e) {
    Logger.error(e);
  }

})();