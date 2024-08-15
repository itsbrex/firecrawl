import { Request, Response } from "express";
import { checkTeamCredits } from "../../../src/services/billing/credit_billing";
import { authenticateUser } from "./auth";
import { RateLimiterMode } from "../../../src/types";
import { isUrlBlocked } from "../../../src/scraper/WebScraper/utils/blocklist";
import { validateIdempotencyKey } from "../../../src/services/idempotency/validate";
import { createIdempotencyKey } from "../../../src/services/idempotency/create";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../../../src/lib/logger";
import { checkAndUpdateURL } from "../../../src/lib/validateUrl";
import { CrawlRequest, CrawlResponse } from "./types";

export async function crawlController(req: Request<{}, {}, CrawlRequest>, res: Response<CrawlResponse>) {
  // expected req.body

  // req.body = {
  //   url: string
  //   crawlerOptions: {
  //     includePaths: string[]
  //     excludePaths: string[]
  //     maxDepth: number
  //     limit: number
  //     allowBackwardLinks: boolean >> TODO: CHANGE THIS NAME???
  //     allowExternalLinks: boolean
  //     ignoreSitemap: number
  //   }
  //   scrapeOptions: Exclude<Scrape, "url">
  // }


  try {
    const { success, team_id, error, status } = await authenticateUser(
      req,
      res,
      RateLimiterMode.Crawl
    );
    if (!success) {
      return res.status(status).json({ success: false, error });
    }

    if (req.headers["x-idempotency-key"]) {
      const isIdempotencyValid = await validateIdempotencyKey(req);
      if (!isIdempotencyValid) {
        return res.status(409).json({ success: false, error: "Idempotency key already used" });
      }
      try {
        createIdempotencyKey(req);
      } catch (error) {
        Logger.error(error);
        return res.status(500).json({ success: false, error: error.message });
      }
    }

    const { success: creditsCheckSuccess, message: creditsCheckMessage } =
      await checkTeamCredits(team_id, 1);
    if (!creditsCheckSuccess) {
      return res.status(402).json({ success: false, error: "Insufficient credits" });
    }

    let url = req.body.url;
    if (!url) {
      return res.status(400).json({ success: false, error: "Url is required" });
    }

    if (isUrlBlocked(url)) {
      return res
        .status(403)
        .json({
          success: false,
          error:
            "Firecrawl currently does not support social media scraping due to policy restrictions. We're actively working on building support for it.",
        });
    }

    try {
      url = checkAndUpdateURL(url).url;
    } catch (error) {
      return res.status(400).json({ success: false, error: 'Invalid Url' });
    }

    // TODO: add job to queue

    const id = uuidv4();
    return res.status(200).json({
      success: true,
      id,
      url: `${req.protocol}://${req.get('host')}/v1/crawl/${id}`,
    });

    // const mode = req.body.mode ?? "crawl";

    // const crawlerOptions = { ...defaultCrawlerOptions, ...req.body.crawlerOptions };
    // const pageOptions = { ...defaultCrawlPageOptions, ...req.body.pageOptions };

    // if (mode === "single_urls" && !url.includes(",")) { // NOTE: do we need this?
    //   try {
    //     const a = new WebScraperDataProvider();
    //     await a.setOptions({
    //       jobId: uuidv4(),
    //       mode: "single_urls",
    //       urls: [url],
    //       crawlerOptions: { ...crawlerOptions, returnOnlyUrls: true },
    //       pageOptions: pageOptions,
    //     });

    //     const docs = await a.getDocuments(false, (progress) => {
    //       job.progress({
    //         current: progress.current,
    //         total: progress.total,
    //         current_step: "SCRAPING",
    //         current_url: progress.currentDocumentUrl,
    //       });
    //     });
    //     return res.json({
    //       success: true,
    //       documents: docs,
    //     });
    //   } catch (error) {
    //     Logger.error(error);
    //     return res.status(500).json({ error: error.message });
    //   }
    // }

    // const job = await addWebScraperJob({
    //   url: url,
    //   mode: mode ?? "crawl", // fix for single urls not working
    //   crawlerOptions: crawlerOptions,
    //   team_id: team_id,
    //   pageOptions: pageOptions,
    //   origin: req.body.origin ?? defaultOrigin,
    // });

    // await logCrawl(job.id.toString(), team_id);

    // res.json({ jobId: job.id });
  } catch (error) {
    Logger.error(error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
