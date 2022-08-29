import { roundToDecimal } from "./utils";

type OriginResourceList = { [origin: string]: PerformanceResourceTiming[] }
type ResourceBins = {
    allImages: PerformanceResourceTiming[];
    allScripts: PerformanceResourceTiming[];
    allXhr: PerformanceResourceTiming[];
    allCss: PerformanceResourceTiming[];
    allFonts: PerformanceResourceTiming[];
    allOther: PerformanceResourceTiming[];
}

var ignoredOrigins = [
    "safeframe.googlesyndication.com",
    "chrome-extension:",
    "moz-extension:"
];

export class ResourceService {

    private hasSent: boolean = false;

    private static cachedResourceTimings: PerformanceResourceTiming[] = null;

    cacheResources() {
        if (this.hasSent) {
            return;
        }
        ResourceService.cachedResourceTimings = ResourceService.getAllResources();
    }

    getResources(): RM.ResourceEntry[] {
        if (this.hasSent) {
            return null;
        }
        var origins = this.getResourcesByOrigin();
        var allOrigins = Object.keys(origins);
        var allEntries = allOrigins.map(originKey => this.getResourceEntryByOrigin(originKey, origins[originKey]));

        return allEntries;
    }

    getPageResourceTimelines(): { imgTimeline: string, xhrTimeline: string, jsTimeline: string, cssTimeline: string, fontTimeline: string, otherTimeline: string } {
        var allResources = ResourceService.getAllResources();
        var { allImages, allScripts, allXhr, allCss, allFonts, allOther } = this.binResources(allResources);

        return {
            imgTimeline: this.getTimeRangesForResources(allImages).join(","),
            xhrTimeline: this.getTimeRangesForResources(allXhr).join(","),
            jsTimeline: this.getTimeRangesForResources(allScripts).join(","),
            cssTimeline: this.getTimeRangesForResources(allCss).join(","),
            fontTimeline: this.getTimeRangesForResources(allFonts).join(","),
            otherTimeline: this.getTimeRangesForResources(allOther).join(",")
        };
    }

    getResourcesByOrigin(): OriginResourceList {
        var allResources = ResourceService.getAllResources();
        var origins = {};

        allResources.forEach((r: PerformanceResourceTiming) => {
            try {
                var origin = this.getOriginFromResource(r);
                if (!origins[origin]) {
                    origins[origin] = []
                }
                origins[origin].push(r);
            }
            catch {
                // ehhhh
            }
        });

        origins["__total"] = allResources;

        return origins;
    }

    getOriginFromResource(resource: PerformanceResourceTiming): string {
        var origin = new URL(resource.name).origin;

        if (origin.startsWith("https://www.google.")) {
            origin = "https://www.google.com";
        }

        return origin;
    }

    getResourceEntryByOrigin(origin: string, resources: PerformanceResourceTiming[]): RM.ResourceEntry {
        var { allImages, allScripts, allXhr, allCss, allFonts, allOther } = this.binResources(resources);

        var entry = {
            origin: origin,
            cssCount: allCss.length,
            cssTime: this.getWallClockTimeForResources(allCss),
            fontCount: allFonts.length,
            fontTime: this.getWallClockTimeForResources(allFonts),
            imgCount: allImages.length,
            imgTime: this.getWallClockTimeForResources(allImages),
            jsCount: allScripts.length,
            jsTime: this.getWallClockTimeForResources(allScripts),
            xhrCount: allXhr.length,
            xhrTime: this.getWallClockTimeForResources(allXhr),
            otherCount: allOther.length,
            otherTime: this.getWallClockTimeForResources(allOther),
            totalCount: resources.length,
            totalTime: this.getWallClockTimeForResources(resources)
        };

        return entry as RM.ResourceEntry;
    }

    static getAllResources(): PerformanceResourceTiming[] {
        var allResources = (ResourceService.cachedResourceTimings || []).concat(performance.getEntriesByType("resource") as PerformanceResourceTiming[]);
        var resourceHash = {};
        allResources = allResources.filter(resource => {
            if (!resource || ResourceService.shouldIgnore(resource)) {
                return false;
            }
            var resourceKey = resource.name + resource.startTime;
            if (resourceHash[resourceKey]) {
                return false;
            }
            resourceHash[resourceKey] = true;
            return true;
        });

        return allResources;
    }

    static shouldIgnore(resource: PerformanceResourceTiming): boolean {
        return ignoredOrigins.some(io => resource.name.toLowerCase().indexOf(io) >= 0);
    }

    binResources(resources: PerformanceEntryList): ResourceBins {
        var allImages = [], allScripts = [], allXhr = [], allCss = [], allFonts = [], allOther = [];
        resources.forEach((resource: PerformanceResourceTiming) => {
            if (this.isImage(resource)) {
                allImages.push(resource);
            }
            else if (this.isScript(resource)) {
                allScripts.push(resource);
            }
            else if (this.isXhr(resource)) {
                allXhr.push(resource);
            }
            else if (this.isCss(resource)) {
                allCss.push(resource);
            }
            else if (this.isFont(resource)) {
                allFonts.push(resource);
            }
            else {
                allOther.push(resource);
            }
        });

        return {
            allImages,
            allScripts,
            allXhr,
            allCss,
            allFonts,
            allOther
        }
    }

    isImage(timing: PerformanceResourceTiming): boolean {
        if (timing.initiatorType === "img") {
            return true;
        }
        try {
            if (timing.initiatorType === "css" || timing.initiatorType === "link") {
                var imgExtensions = [".jpg", ".jpeg", ".png", ".gif", ".svg", ".raw", ".webp", ".heif", ".avif"];
                var pathname = new URL(timing.name).pathname.toLowerCase();
                return imgExtensions.some(imgExt => pathname.endsWith(imgExt));
            }
        }
        catch { }

        return false;
    }

    isScript(timing: PerformanceResourceTiming): boolean {
        if (timing.initiatorType === "script") {
            return true;
        }
        try {
            if (timing.initiatorType === "link" || timing.initiatorType === "other") {
                var jsExtensions = [".js", ".json"];
                var pathname = new URL(timing.name).pathname.toLowerCase();
                return jsExtensions.some(jsExt => pathname.endsWith(jsExt));
            }
        }
        catch { }

        return false;
    }

    isXhr(timing: PerformanceResourceTiming): boolean {
        return timing.initiatorType === "fetch" || timing.initiatorType === "xmlhttprequest";
    }

    isCss(timing: PerformanceResourceTiming): boolean {
        if (timing.initiatorType !== "link" && timing.initiatorType !== "css") {
            return false;
        }
        try {
            var pathname = new URL(timing.name).pathname;
            return pathname.toLowerCase().endsWith("css");
        }
        catch { }

        return false;
    }

    isFont(timing: PerformanceResourceTiming): boolean {
        if (timing.initiatorType !== "link" && timing.initiatorType !== "css" && timing.initiatorType !== "other") {
            return false;
        }
        try {
            var fontExtensions = [".woff", ".woff2", ".ttf", ".eot", ".otf"];
            var pathname = new URL(timing.name).pathname.toLowerCase();
            return fontExtensions.some(fontExt => pathname.endsWith(fontExt));
        }
        catch { }

        return false;
    }

    getWallClockTimeForResources(resources: PerformanceResourceTiming[]): number {
        var ranges = this.getTimeRangesForResources(resources);
        var totalWallClockDuration = ranges.reduce((duration, range) => {
            return duration + range.duration;
        }, 0);

        return roundToDecimal(totalWallClockDuration);
    }

    getTimeRangesForResources(resources: PerformanceResourceTiming[]): TimeRange[] {
        resources = resources.sort((a, b) => a.startTime - b.startTime);
        var ranges: TimeRange[] = [];
        resources.forEach(timing => {
            var lastRange = ranges[ranges.length - 1];
            if (lastRange && lastRange.isWithinRange(timing)) {
                lastRange.applyTiming(timing);
            }
            else {
                ranges.push(new TimeRange(timing))
            }
        });

        return ranges;
    }

    sentResources() {
        this.hasSent = true;
        ResourceService.cachedResourceTimings = null;
    }
}

class TimeRange {
    public start: number;
    public end: number;

    get duration(): number {
        return this.end - this.start;
    }

    constructor(timing: PerformanceResourceTiming) {
        this.start = timing.startTime;
        this.end = timing.responseEnd;
    }

    isWithinRange(timing: PerformanceResourceTiming): boolean {
        return timing.startTime <= this.end;
    }

    applyTiming(timing: PerformanceResourceTiming) {
        if (this.end < timing.responseEnd) {
            this.end = timing.responseEnd;
        }
    }

    toString() {
        return `${roundToDecimal(this.start)}-${roundToDecimal(this.end)}`;
    }

}
