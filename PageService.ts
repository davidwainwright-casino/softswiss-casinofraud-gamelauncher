import { ResourceService } from "./ResourceService";
import { isWorker, roundToDecimal, truncateUrl } from "./utils";

export class PageService {

    private pageUrl?: string;

    private hasSentPage = false;

    getPageUrl(): string {
        return this.pageUrl || truncateUrl(self.location.toString())
    }

    getPageEntry(): RM.PagePerformanceEntry {
        if (isWorker()) { return null; }
        if (this.hasSentPage) { return null; }

        var entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        var result: RM.PagePerformanceEntry = null;

        // NOTE Safari doesn't have a navigation entry, so we need to crawl the old Timings API
        if (!entry) {
            var timings = performance.timing;
            result = {
                url: truncateUrl(self.location.toString()),
                start: 0,
                duration: roundToDecimal(timings.domComplete - timings.navigationStart),
                domInteractive: roundToDecimal(timings.domInteractive - timings.navigationStart),
                dnsTime: roundToDecimal(timings.domainLookupEnd - timings.domainLookupStart),
                // For now, sslTime includes full TCP connection time. JUST sslTime looks like this:
                //sslTime: timings.secureConnectionStart ? timings.connectEnd - timings.secureConnectionStart : 0,
                sslTime: roundToDecimal(timings.connectEnd - timings.connectStart),
                serverTime: roundToDecimal(timings.responseEnd - timings.requestStart),
                blockingAssetLoadTime: roundToDecimal(timings.domInteractive - timings.responseEnd),
                firstByteTime: roundToDecimal(timings.responseStart - timings.navigationStart)
            };
        }
        else {
            result = {
                // Sometimes entry.name contains "document" because of a misunderstanding in the w3 spec,
                // but we want to use it if it's a URL, since the self location might have been pushState'd.
                url: truncateUrl(entry.name.indexOf("http") === 0 ? entry.name : self.location.toString()),
                start: roundToDecimal(entry.startTime),
                duration: roundToDecimal(entry.duration),
                domInteractive: roundToDecimal(entry.domInteractive),
                dnsTime: roundToDecimal(entry.domainLookupEnd - entry.domainLookupStart),
                // For now, sslTime includes full TCP connection time. JUST sslTime looks like this:
                //sslTime: entry.secureConnectionStart ? entry.connectEnd - entry.secureConnectionStart : 0,
                sslTime: roundToDecimal(entry.connectEnd - entry.connectStart),
                serverTime: roundToDecimal(entry.responseEnd - entry.requestStart),
                blockingAssetLoadTime: roundToDecimal(entry.domInteractive - entry.responseEnd),
                firstByteTime: roundToDecimal(entry.responseStart),
                pageSize: entry.transferSize
            };
        }

        this.pageUrl = result.url;

        var timelines = new ResourceService().getPageResourceTimelines();
        result = { ...result, ...timelines }

        return result;
    }

    sentPage() {
        this.hasSentPage = true;
    }
}