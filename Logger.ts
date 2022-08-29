const MAX_LOGGER_SENDS = 2;
var loggerSends = 0;

export const Logger = {

  token: "empty token",
  errorCount: 0,
  tjsToken: "8de4c78a3ec64020ab2ad15dea1ae9ff",
  tjsApp: "rmagent",
  tjsVersion: "3.6.0",

  getErrorUrl: () => "https://capture.trackjs.com/capture?token=" + Logger.tjsToken + "&v=" + Logger.tjsVersion + "&source=rm",

  error: (error: Error, additionalInfo: string = null) => {
    if (!CONSTANTS.IS_PROD) {
      throw error;
    }

    if (loggerSends >= MAX_LOGGER_SENDS) {
      return;
    }
    var safeError = error || {} as Error;
    var message = safeError.message || "empty";
    var stack = safeError.stack || new Error().stack;

    Logger.errorCount++;
    var url = (self.location || "").toString();
    var payload = {
      "agentPlatform": "browser",
      "console": [{
        "message": JSON.stringify(error),
        "severity": "log",
        "timestamp": new Date().toISOString()
      }],
      "customer": {
        "token": Logger.tjsToken,
        "application": Logger.tjsApp,
        "userId": Logger.token,
        "version": CONSTANTS.VERSION
      },
      "entry": "catch",
      "environment": {
        "originalUrl": url,
        "userAgent": navigator.userAgent,
      },
      "message": message,
      "url": url,
      "stack": stack,
      "timestamp": new Date().toISOString(),
      "version": Logger.tjsVersion
    };
    if (additionalInfo != null) {
      payload.console.push({
        "message": additionalInfo,
        "severity": "log",
        "timestamp": new Date().toISOString()
      })
    }

    var xhr = new XMLHttpRequest();
    xhr.open("POST", Logger.getErrorUrl());
    xhr.send(JSON.stringify(payload));

    loggerSends++;
  }

};




