/**
 * §8.4 — validation for a consignment catalogue.
 *
 * Every row is checked before ANY row is written. A brand's spreadsheet with
 * one bad price should not leave half a catalogue imported: this is the
 * difference between a ten-minute job and an afternoon of cleanup.
 *
 * The rule that matters is `price > cost` on every row. It is checked here so
 * the operator sees all the problems at once, and again by the database, which
 * is what actually enforces it (§3.1 `price_above_cost`).
 */

export const REQUIRED = ['title', 'price', 'cost'];

const ALIASES = {
  title: ['title', 'name', 'product', 'product_name'],
  price: ['price', 'price_pkr', 'selling_price', 'retail_price', 'mrp'],
  cost: ['cost', 'cost_pkr', 'buying_price', 'our_price', 'wholesale'],
  stock: ['stock', 'qty', 'quantity', 'stock_on_hand', 'available'],
  images: ['images', 'image', 'image_urls', 'photos', 'photo_urls'],
  category: ['category', 'category_name', 'type'],
};

function pick(record, field) {
  for (const alias of ALIASES[field] ?? [field]) {
    if (record[alias] !== undefined && record[alias] !== '') return record[alias];
  }
  return '';
}

/**
 * Money arrives as "3,200", "PKR 3200", "3200.00" or "3200/-". All of those
 * mean the same integer number of rupees; anything else is an error rather than
 * a guess.
 */
export function parseMoney(raw) {
  if (raw === '' || raw == null) return null;
  const cleaned = String(raw)
    .replace(/pkr|rs\.?|\/-/gi, '')
    .replace(/,/g, '')
    .trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  // PKR has no circulating subunit; a price with paisa is a typo, not a price.
  if (!Number.isInteger(value)) return Math.round(value);
  return value;
}

export function parseImages(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[|\n;]|,(?=\s*https?:)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** §0, mirrored client-side so the operator sees it before importing. */
export const maxCoinDiscountPkr = (price, cost) =>
  Math.max(0, Math.min(Math.floor(0.2 * (price - cost)), Math.floor(0.1 * price)));

export function validateRecords(records) {
  const rows = [];
  const errors = [];
  const seenTitles = new Map();

  for (const record of records) {
    const line = record.__line;
    const title = pick(record, 'title');
    const price = parseMoney(pick(record, 'price'));
    const cost = parseMoney(pick(record, 'cost'));
    const stockRaw = pick(record, 'stock');
    const stock = stockRaw === '' ? 0 : parseMoney(stockRaw);
    const images = parseImages(pick(record, 'images'));
    const category = pick(record, 'category') || null;

    if (!title) {
      errors.push({ line, field: 'title', message: 'missing a title' });
      continue;
    }
    if (price === null) {
      errors.push({ line, field: 'price', title, message: `price is not a number: "${pick(record, 'price')}"` });
      continue;
    }
    if (cost === null) {
      errors.push({ line, field: 'cost', title, message: `cost is not a number: "${pick(record, 'cost')}"` });
      continue;
    }
    if (price <= 0) {
      errors.push({ line, field: 'price', title, message: `price must be above zero, got ${price}` });
      continue;
    }
    if (cost < 0) {
      errors.push({ line, field: 'cost', title, message: `cost cannot be negative, got ${cost}` });
      continue;
    }
    // §8.4 asks for exactly this check, and §0 depends on it.
    if (price <= cost) {
      errors.push({
        line,
        field: 'price',
        title,
        message: `price ${price} is not above cost ${cost} — this row would sell at a loss before any discount`,
      });
      continue;
    }
    if (stock === null || stock < 0) {
      errors.push({ line, field: 'stock', title, message: `stock must be zero or more, got "${stockRaw}"` });
      continue;
    }

    const key = title.toLowerCase();
    if (seenTitles.has(key)) {
      errors.push({
        line, field: 'title', title,
        message: `duplicate of the row on line ${seenTitles.get(key)}`,
      });
      continue;
    }
    seenTitles.set(key, line);

    rows.push({
      line,
      title,
      price_pkr: price,
      cost_pkr: cost,
      stock,
      images,
      category,
      margin_pkr: price - cost,
      margin_pct: (Math.round((1000 * (price - cost)) / price) / 10).toFixed(1),
      max_discount_pkr: maxCoinDiscountPkr(price, cost),
    });
  }

  return { rows, errors };
}
