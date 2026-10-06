# Real screenshot validation

6 October 2026. Source: the two JPEGs supplied locally in `/Users/janibulhoque/Downloads/uber/`. Originals remain outside the repository. Recognition used actual Tesseract.js 7.0.0 with local English assets, followed by the experimental deterministic parser.

Command: `npx tsx scripts/validate-samples.ts /Users/janibulhoque/Downloads/uber`. The field-level report, sample hashes and source-position coverage are written to `/tmp/uber-real-layout-report.json`. The expected values were read from the supplied images before comparing engine output.

| Field | Sample 1 | Sample 2 |
| --- | --- | --- |
| Cash collected | BDT 407.38 matched | BDT 596.24 matched |
| Tips | BDT 40.00 matched | Missing retained as unknown |
| Pickup time | 13:04:00 matched | 11:58:00 matched |
| Duration | 2,350 seconds matched | 3,214 seconds matched |
| Distance | 8.260 km matched | 12.550 km matched |
| Service | Uber X matched | Uber Premier preserved in evidence; enum Other |
| Full trip date | Unknown: day/month lacks year | Unknown: no date shown |
| Uber credit, commission, per-ride pass | Each remains unknown | Each remains unknown |
| Reported net earnings | Unknown: unlabelled headline not classified as net | Unknown: unlabelled headline not classified as net |
| Route | Candidate retained; icon OCR artifacts require correction | Candidate retained; icon OCR artifacts require correction |

Both samples matched all 11 asserted field outcomes, including deliberate missing-value outcomes. OCR produced source boxes for 8 observations in sample 1 and 7 in sample 2. These are two examples of the driver trip-summary layout, not a measured general extraction accuracy. Route text is provisional and must be compared/corrected. Map text is never treated as a route or source of a trip year. This layout does not provide the complete financial breakdown or receipts/tips interpretation needed for review; users must supply and confirm those values.

Other receipt layouts, Bangla recognition, already-net screenshots, conflicts and multi-image trips are covered by synthetic parser/domain fixtures only. Parsing remains visibly experimental. Real-layout failures and unsupported meanings retain original images, exact OCR and candidate evidence for manual review.
