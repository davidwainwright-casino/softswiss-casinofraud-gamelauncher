import { Logger } from "./Logger";

export function isWorker() {
  return (typeof document === "undefined");
}

export function isURLSupported(): boolean {
  return !!(self.URL && self.URL.prototype && ('hostname' in self.URL.prototype));
}

export function truncateUrl(url: string): string {
  url = url || "";
  if (url.indexOf("?") >= 0) {
    url = url.split("?")[0];
  }
  if (url.length >= 1000) {
    url = url.substr(0, 1000);
  }
  return url;
}

export function roundToDecimal(num: number, places: number = 0): number {
  return parseFloat(num.toFixed(places));
}

export function isFirstPartyUrl(url: string, pageUrl: string): boolean {
  var tls = getTopLevelSegment(pageUrl);
  if (!tls) {
    return false;
  }

  try {
    var hostname = new URL(url).hostname;
    if (!hostname) {
      return false;
    }
    return hostname.indexOf(tls) >= 0;
  }
  catch (e) {
    Logger.error(e, `Problem parsing first party url: ${url}`)
    return false;
  }
}

var reservedTLDs = ["com", "net", "gov", "edu", "org"];

export function getTopLevelSegment(pageUrl: string): string {
  try {
    if (!pageUrl || pageUrl.indexOf("http") !== 0) {
      return null;
    }
    var url = new URL(pageUrl);
    var hostname = url.hostname;
    if (!hostname) {
      return null;
    }

    var segments = hostname.split(".");

    // ignore last segment, should be .com or whatever cute tld they use
    var firstSegment = segments.pop();
    if (firstSegment === "localhost") {
      return firstSegment;
    }

    if (hostname === "127.0.0.1") {
      return hostname;
    }

    var lastSegment = segments.pop();

    // If it's something like co.uk or mn.us
    if (lastSegment.length === 2) {
      lastSegment = segments.pop();
    }

    // Something like com.au
    if (reservedTLDs.indexOf(lastSegment) >= 0) {
      lastSegment = segments.pop();
    }

    return `${lastSegment}.`;

  }
  catch (e) {
    Logger.error(e, `Page Url: ${pageUrl}`)
    return null;
  }

}
