import { Logger } from "./Logger";
import { PageService } from "./PageService";
import { ResourceService } from "./ResourceService";
import { isFirstPartyUrl, isURLSupported, isWorker, roundToDecimal, truncateUrl } from "./utils";
import { WebVitalsObserver } from "./WebVitalsObserver";

const SEND_ENDPOINT_THRESHOLD: number = 10;
const MAX_ENDPOINT_LIMIT: number = 50;
const MAX_SENDS: number = 10;

export class Agent {

  static defaults: RM.InstallOptions = {
    token: null,
    ingestUrl: "https://in.requestmetrics.com/v1",
    monitorSelfCalls: false
  };

  public options: RM.InstallOptions;
  private timeOrigin = null;
  private entryHash = {};
  public endpoints: RM.EndpointPerformanceEntry[] = [];
  private webVitalsObserver: WebVitalsObserver;
  private pageService = new PageService();
  private resourceService = new ResourceService();
  private shutdownSend = false;
  private sendCount = 0;

  getIngestUrl = () => `${this.options.ingestUrl}?token=${this.options.token}&v=${CONSTANTS.VERSION}`;

  constructor(options: RM.InstallOptions) {
    // NOTE Safari <12 has performance but not `getEntriesByType`
    if (!self.performance || !self.performance.getEntriesByType || !isURLSupported()) {
      return;
    }

    // NOTE Mobile Safari <=7 and other old mobile browsers have a performance
    // object but no timings.
    var navEntry = performance.getEntriesByType("navigation") || [];
    if (!isWorker() && !navEntry.length && !performance.timing) {
      return;
    }

    // IE11 doesn't support Object.assign, so here is a naive polyfill for our use-case.
    this.options = Object.keys(Agent.defaults).reduce((result, key) => {
      result[key] = options[key] || Agent.defaults[key];
      return result;
    }, {}) as RM.InstallOptions;

    // NOTE Safari doesn't support timeOrigin yet. It doesn't have timing in workers.
    // @see https://developer.mozilla.org/en-US/docs/Web/API/Performance/timeOrigin
    this.timeOrigin = performance.timeOrigin || (performance.timing || {}).navigationStart || new Date().getTime();

    this.manageResourceBuffer();

    (function (ready) {
      if (isWorker() || document.readyState === "complete") {
        ready();
      } else {
        document.addEventListener('readystatechange', (event) => {
          if (document.readyState === "complete") {
            ready();
          }
        });
      }
    })(() => { /* the document is now ready. */
      try {
        this.webVitalsObserver = new WebVitalsObserver(() => {
          this.checkAndSend();
        });

        setTimeout(() => this.checkAndSend(), 1000);
        setInterval(() => this.checkAndSend(), 60 * 1000);

        self.addEventListener("pagehide", () => this.sendBeacon());
        self.addEventListener("visibilitychange", () => {
          if (!isWorker() && document.visibilityState === 'hidden') {
            this.sendBeacon();
          }
        });
      }
      catch (e) {
        Logger.error(e);
      }
    });
  }

  getEndpointEntries(): RM.EndpointPerformanceEntry[] {
    var result: RM.EndpointPerformanceEntry[] = [];

    ResourceService.getAllResources().forEach((entry: PerformanceResourceTiming) => {

      if (Object.keys(this.entryHash).length >= MAX_ENDPOINT_LIMIT) {
        return;
      }
      // Duration is negative if the request is still in flight. This happens because duration is calculated by
      // entry.responseEnd - entry.startTime. While the request is in progress, this will result in "-startTime".
      // We want to exclude this *before* entering it in our hash so that we can capture it later, when it completes.
      if (entry.duration <= 0) {
        return;
      }

      if (entry.initiatorType !== "xmlhttprequest" && entry.initiatorType !== "fetch") {
        return;
      }

      var entryUrl = truncateUrl(entry.name);

      if (!isFirstPartyUrl(entryUrl, self.location.toString())) {
        return;
      }

      var entryKey = entryUrl + entry.startTime;
      if (this.entryHash[entryKey]) { return; }

      if (!this.options.monitorSelfCalls && this.getIngestUrl().indexOf(entryUrl) === 0) {
        // We don't want to include our own ingest API in the reports.
        return;
      }
      if (Logger.errorCount > 0 && Logger.getErrorUrl().indexOf(entryUrl) === 0) {
        return;
      }
      this.entryHash[entryKey] = true;

      result.push({
        url: entryUrl,
        start: roundToDecimal(entry.startTime),
        duration: roundToDecimal(entry.duration)
      });

    });
    return result;
  }

  getDevice(): RM.Device {
    try {
      if (/Mobi|Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        return "mobile";
      }
    }
    catch (e) {/* don't care */ }

    return "desktop";
  }

  getPayload(): RM.PerformancePayload {
    this.endpoints = this.endpoints.concat(this.getEndpointEntries());

    var payload = {
      token: this.options.token,
      timeOrigin: new Date(this.timeOrigin).toISOString(),
      timeSent: new Date().toISOString(),
      device: this.getDevice(),
      page: this.pageService.getPageEntry(),
      endpoints: [...this.endpoints],
      vitals: this.webVitalsObserver?.getVitals(this.pageService.getPageUrl()),
      resources: this.resourceService.getResources()
    };

    return payload;
  }

  payloadHasData(payload: RM.PerformancePayload): boolean {
    if (this.shutdownSend) {
      return false;
    }
    if (this.sendCount >= MAX_SENDS) {
      return false;
    }
    if (!payload) {
      return false;
    }
    if (payload.page || payload.endpoints.length || payload.vitals || payload.resources) {
      return true;
    }
    return false;
  }

  shouldSendInterval(payload: RM.PerformancePayload): boolean {
    if (!this.payloadHasData(payload)) {
      return false;
    }
    if (payload.page || payload.vitals || payload.resources || isWorker() || payload.endpoints.length >= SEND_ENDPOINT_THRESHOLD) {
      return true;
    }
    return false;
  }

  checkAndSend() {
    try {
      var payload = this.getPayload();

      if (!this.shouldSendInterval(payload)) {
        return;
      }

      this.clearPayloadAfterSend(payload);

      // NOTE [Todd] We used to use Fetch here, but it had a high failure rate of
      // aborted attempts that resulted in "Failed to fetch" warnings in TrackJS.
      // We're not entirely sure why this happens, but there are no errors with XHR.
      // This might be silently failing as well, but we don't want users seeing it
      // regardless, so sticking with XHR. FTW.
      var xhr = new XMLHttpRequest();
      xhr.open("POST", this.getIngestUrl());
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.addEventListener("load", () => {
        if (xhr.status >= 400) {
          this.shutdownSend = true;
        }
      })
      xhr.send(JSON.stringify(payload));
    }
    catch (e) {
      Logger.error(e);
    }
  }

  sendBeacon = () => {
    try {
      var payload = this.getPayload();
      if (navigator.sendBeacon && this.payloadHasData(payload)) {
        this.clearPayloadAfterSend(payload);
        var url = this.getIngestUrl();
        var data = JSON.stringify(payload);
        try {
          navigator.sendBeacon(url, data);
        }
        catch (e) { /* Something broke the browser beacon API */ }
      }
    }
    catch (e) {
      Logger.error(e);
    }
  }

  clearPayloadAfterSend(payload: RM.PerformancePayload) {
    this.sendCount++;
    this.endpoints.length = 0;
    if (payload.page) {
      this.pageService.sentPage();
    }
    if (payload.vitals) {
      this.webVitalsObserver?.sentVitals();
    }
    if (payload.resources) {
      this.resourceService.sentResources();
    }
  }

  manageResourceBuffer(): void {
    if (performance.setResourceTimingBufferSize) {
      performance.setResourceTimingBufferSize(1000);
    }

    var handleResourceTimingBufferFullEvt = (evt) => {
      this.resourceService.cacheResources();
      performance.clearResourceTimings();
    }

    if (performance.addEventListener) {
      try {
        performance.addEventListener("resourcetimingbufferfull", handleResourceTimingBufferFullEvt);
      }
      catch (e) {
        // Firefox 82 blows up when calling performance.addEventListener in a web worker.
        // For now, we're just ignoring the error and not cleaning up the buffer.
        // @see https://bugzilla.mozilla.org/show_bug.cgi?id=1674254
      }

    }
    else {
      // TODO later, pass through to other listeners?
      performance.onresourcetimingbufferfull = handleResourceTimingBufferFullEvt;
    }


    // NOTE: Maybe in the future we should clear the entry hash/lookup if we
    // are in a situation where there are lots of resources doing lots of things. AKA a shitty site.
  }
}