import { Logger } from "./Logger";
import { isWorker, roundToDecimal, truncateUrl } from "./utils";

export class WebVitalsObserver {

  private vitalsSent = false;
  private userInteracted = false;
  private isUnloading = false;
  private isBackgroundTab = false;
  private layoutObserver: PerformanceObserver;
  private cls: null | number = null;
  private largestPaintObserver: PerformanceObserver;
  private lcp: null | number = null;
  private firstInputObserver: PerformanceObserver;
  private fid: null | number = null;
  private firstPaintObserver: PerformanceObserver;
  private fcp: null | number = null;

  constructor(onVitalsReady: () => void) {

    if (isWorker()) {
      this.isBackgroundTab = true;
      return;
    }

    self.addEventListener("keydown", () => {
      this.userInteracted = true;
      onVitalsReady();
    }, { once: true, capture: true });
    self.addEventListener("click", () => {
      this.userInteracted = true;
      onVitalsReady();
    }, { once: true, capture: true });
    setTimeout(() => {
      this.userInteracted = true;
      onVitalsReady();
    }, 30*1000);

    self.addEventListener('pagehide', (event: PageTransitionEvent) => {
      this.isUnloading = !event.persisted;
    });

    this.isBackgroundTab = document.visibilityState === 'hidden';
    document.addEventListener('visibilitychange', (event) => {
      if (!this.isUnloading) {
        this.isBackgroundTab = true;
      }
    }, { once: true });

    this.layoutObserver = this.addPerformanceObserver("layout-shift", this.handleLayoutShift);
    if (this.layoutObserver) {
      this.cls = 0;
    }

    this.largestPaintObserver = this.addPerformanceObserver("largest-contentful-paint", this.handleLargestPaint);
    if (this.largestPaintObserver) {
      this.lcp = 0;
    }

    this.firstPaintObserver = this.addPerformanceObserver("paint", this.handleFirstPaint);
    if (this.firstPaintObserver) {
      this.fcp = 0;
    }

    this.firstInputObserver = this.addPerformanceObserver("first-input", this.handleFirstInput);
  }

  getVitals(url: string): RM.VitalsEntry {
    // NOTE The performance numbers reported are very inaccurate if the tab was loaded in the background or deselected
    // during the loading process. Layout shifts might not be reported and contentful paints will be delayed until the
    // tab has focus. Rather than reporting inaccurate data, we don't report anything.
    if (this.isBackgroundTab) {
      return null;
    }
    if (this.vitalsSent) {
      return null;
    }
    if (!this.userInteracted && !this.isUnloading) {
      return null;
    }

    var anyMetric = false;
    var resultVitals: RM.VitalsEntry = {
      url: url
    };

    if (this.cls !== null) {
      resultVitals.cls = roundToDecimal(this.cls, 5);
      anyMetric = true;
    }

    if (this.lcp !== null && this.lcp > 0) {
      resultVitals.lcp = roundToDecimal(this.lcp);
      anyMetric = true;
    }

    if (this.fcp !== null && this.fcp > 0) {
      resultVitals.fcp = roundToDecimal(this.fcp);
      anyMetric = true;
    }

    if (this.fid !== null) {
      resultVitals.fid = roundToDecimal(this.fid, 1);
      anyMetric = true;
    }

    return anyMetric ? resultVitals : null;
  }

  sentVitals() {
    this.layoutObserver?.disconnect();
    this.firstInputObserver?.disconnect();
    this.firstPaintObserver?.disconnect();
    this.largestPaintObserver?.disconnect();
    this.vitalsSent = true;
  }

  private handleLayoutShift = (entry: LayoutShift) => {
    if (!entry.hadRecentInput) { // ignore shifts caused by user input
      this.cls += entry.value;
    }
  }

  private handleLargestPaint = (entry: PerformanceEntry) => {
    if (entry.startTime > this.lcp) {
      this.lcp = entry.startTime;
    }
  }

  private handleFirstPaint = (entry: PerformanceEntry) => {
    if (entry.name === "first-contentful-paint" && entry.startTime) {
      this.fcp = entry.startTime;
    }
  }

  private handleFirstInput = (entry: FirstInputEntry) => {
    this.fid = entry.processingStart - entry.startTime;
  }

  private addPerformanceObserver(type: string, callback: any): PerformanceObserver | undefined {
    try {
      if (PerformanceObserver.supportedEntryTypes.indexOf(type) >= 0) {
        var po = new PerformanceObserver((result) => result.getEntries().map((evt) => {
          try {
            return callback(evt);
          }
          catch (e) {
            Logger.error(e);
          }
        }));
        po.observe({
          type: type,
          buffered: true
        });
        return po;
      }
    } catch (e) {
      // Do nothing.
    }
    return;
  }
}
