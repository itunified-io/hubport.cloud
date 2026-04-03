/**
 * PDF renderer — uses Puppeteer to screenshot MapLibre maps,
 * then composes PDF documents with pdfkit.
 * The HTML template is inlined to avoid build/copy issues with tsc.
 */
import puppeteer, { type Browser } from "puppeteer-core";
import PDFDocument from "pdfkit";

/** Minimal MapLibre HTML page — inlined to avoid file resolution issues at runtime. */
function buildMapHtml(config: {
  style: string;
  apiKey: string;
  bounds: [[number, number], [number, number]];
  geometry: { type: string; coordinates: unknown };
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{width:1280px;height:900px;overflow:hidden}#map{width:100%;height:100%}</style>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
</head><body><div id="map"></div><script>
const cfg=${JSON.stringify(config)};
const styleUrl=cfg.style==="satellite"
  ?"https://api.maptiler.com/maps/satellite/style.json?key="+cfg.apiKey
  :"https://api.maptiler.com/maps/streets-v2/style.json?key="+cfg.apiKey;
const map=new maplibregl.Map({container:"map",style:styleUrl,bounds:cfg.bounds,
  fitBoundsOptions:{padding:40},interactive:false,attributionControl:false});
map.on("load",()=>{
  map.addSource("territory",{type:"geojson",data:{type:"Feature",geometry:cfg.geometry,properties:{}}});
  map.addLayer({id:"territory-fill",type:"fill",source:"territory",paint:{"fill-color":"rgba(212,160,23,0.15)"}});
  map.addLayer({id:"territory-outline",type:"line",source:"territory",paint:{"line-color":"#d4a017","line-width":3}});
});
map.once("idle",()=>{window.__MAP_READY__=true});
</script></body></html>`;
}

interface RenderRequest {
  number: string;
  name: string;
  geometry: { type: string; coordinates: unknown };
  bounds: [[number, number], [number, number]];
  style: "satellite" | "street";
  apiKey: string;
}

/** Calculate LngLat bounds from GeoJSON geometry with padding. */
export function calcBounds(
  geometry: { type: string; coordinates: unknown },
  padding = 0.15,
): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  const flatten = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const pt = c as number[];
      if (pt[0]! < minLng) minLng = pt[0]!;
      if (pt[0]! > maxLng) maxLng = pt[0]!;
      if (pt[1]! < minLat) minLat = pt[1]!;
      if (pt[1]! > maxLat) maxLat = pt[1]!;
    } else if (Array.isArray(c)) {
      for (const item of c) flatten(item);
    }
  };
  flatten(geometry.coordinates);

  const lngPad = (maxLng - minLng) * padding;
  const latPad = (maxLat - minLat) * padding;

  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad],
  ];
}

/** Render a single map screenshot via Puppeteer. Returns PNG buffer. */
async function renderMapScreenshot(
  browser: Browser,
  req: RenderRequest,
): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const html = buildMapHtml({
    style: req.style,
    apiKey: req.apiKey,
    bounds: req.bounds,
    geometry: req.geometry,
  });

  await page.setContent(html, { waitUntil: "networkidle0" });

  // Wait for map idle (tiles loaded), with 30s timeout
  await page.waitForFunction("window.__MAP_READY__ === true", { timeout: 30_000 }).catch(async () => {
    // Retry once after 5s
    await new Promise((r) => setTimeout(r, 5000));
    await page.waitForFunction("window.__MAP_READY__ === true", { timeout: 25_000 });
  });

  const screenshot = await page.screenshot({ type: "png" }) as Buffer;
  await page.close();
  return screenshot;
}

/** Compose a PDF with header + map image. Returns PDF as Buffer. */
export async function composePdf(
  mapImage: Buffer,
  number: string,
  name: string,
  style: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 842;
    const headerH = 40;

    // Header background
    doc.rect(0, 0, W, headerH).fill("#1a1a2e");

    // Amber accent line
    doc.rect(0, headerH - 2, W, 2).fill("#d4a017");

    // Header text
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff");
    doc.text(`T-${number} — ${name}`, 16, 12, { width: W / 2 });

    doc.font("Helvetica").fontSize(9).fillColor("#9ca3af");
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.text(`${style} · ${dateStr}`, W - 200, 15, { width: 184, align: "right" });

    // Map image
    doc.image(mapImage, 0, headerH, { width: W, height: 595 - headerH });

    doc.end();
  });
}

/** Render PDFs for multiple territories. Returns array of { filename, buffer }. */
export async function renderTerritoryPdfs(
  territories: Array<{
    number: string;
    name: string;
    boundaries: unknown;
  }>,
  styles: ("satellite" | "street")[],
  apiKey: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): Promise<{ files: Array<{ filename: string; buffer: Buffer }>; errors: string[] }> {
  const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser";
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  const files: Array<{ filename: string; buffer: Buffer }> = [];
  const errors: string[] = [];

  // Process territories with concurrency limit of 3
  const CONCURRENCY = 3;
  const tasks: Array<{ territory: typeof territories[0]; style: "satellite" | "street" }> = [];
  for (const t of territories) {
    for (const s of styles) {
      tasks.push({ territory: t, style: s });
    }
  }

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ territory: t, style }) => {
        const geom = t.boundaries as { type: string; coordinates: unknown };
        const bounds = calcBounds(geom);
        const sanitized = t.name
          .toLowerCase()
          .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
          .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        const filename = `T-${t.number}-${sanitized}-${style}.pdf`;

        logger.info(`Rendering ${filename}...`);
        const screenshot = await renderMapScreenshot(browser, {
          number: t.number,
          name: t.name,
          geometry: geom,
          bounds,
          style,
          apiKey,
        });
        const pdf = await composePdf(screenshot, t.number, t.name, style);
        return { filename, buffer: pdf };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const task = batch[j]!;
      if (result.status === "fulfilled") {
        files.push(result.value);
      } else {
        const msg = `Failed: T-${task.territory.number} (${task.style}): ${result.reason}`;
        logger.error(msg);
        errors.push(msg);
      }
    }
  }

  await browser.close();
  return { files, errors };
}
