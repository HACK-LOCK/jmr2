/**
 * Reads a supplier list - pasted or uploaded as a text or sheet file - into
 * clean stock rows.
 *
 * The list is laid out the way the desk writes it:
 *
 *     Oppo
 *     Battery -5
 *     =2 Charger
 *     Display 3
 *     Oppo A15 Battery - 5
 *     Samsung M30 Display = 2
 *     - Vivo Y20 Folder - 10 pcs
 *
 * A line with no quantity is a brand heading; everything under it belongs to
 * that brand. A line with a quantity is one item, and the quantity may sit
 * before or after the name (`Charger 5` or `5 Charger`). The desk also writes
 * a `-` or `=` in front of the number or between name and quantity, and a `-`
 * bullet before the name. The number on the right of `-` or `=` is auto-detected
 * as the quantity.
 *
 * Brand and category are auto-detected from the name:
 * - Brand: Starts with or contains a known mobile company brand (e.g. Oppo, Vivo, Samsung, Realme...)
 * - Category: If the item name sounds like battery (battery, battry, bettry, btry), display
 *   (display, folder, combo, touch, screen), charger, cover, glass, cc connector, speaker, etc.,
 *   it is filed into that specific category section.
 *
 * Inside Add / Import Stock, the items are neatly structured under Brand -> Category Section.
 */

import type { PartListItem } from './types';

export interface StockImportRow {
  name: string;
  brand: string;
  category: string;
  quantity: number;
  partId?: string;
  matchedPartName?: string;
  currentStock?: number;
}

export interface StockCategoryGroup {
  category: string;
  rows: StockImportRow[];
  totalUnits: number;
}

export interface StockBrandGroup {
  brand: string;
  categories: StockCategoryGroup[];
  totalItems: number;
  totalUnits: number;
}

export interface StockImportPlan {
  rows: StockImportRow[];
  /** Lines the list had to set the current brand, brand by brand. */
  brands: string[];
  /** Lines that could not be read - shown so nothing is silently dropped. */
  skipped: string[];
  /** Hierarchical structure: Brand -> Category Section -> Items */
  grouped: StockBrandGroup[];
}

const MAX_QUANTITY = 1_000_000;

/** Bullet start at the beginning of a line (e.g. `- `, `= `, `• `, `* `, `1. `, `1) `) */
const bulletStart = /^([-=•*]+|\d+[\.\)]|\[\s*\])\s+/;

/** Optional unit suffix (e.g. `pcs`, `nos`, `pc`, `pieces`, `units`, `pkt`, `qty`) */
const unitPattern = `(?:pcs?|pieces?|nos?\.?|units?|packets?|pkts?|qty)`;

/** Trailing quantity with explicit separator: `Name - 5`, `Name = 5`, `Name -5`, `Name =5`, `Name: 5`, `Name - 5 pcs` */
const trailingWithSeparator = new RegExp(
  `^(.*?)\\s*[-=:]+\\s*(\\d+)\\s*(?:${unitPattern})?\\.?$`,
  'i',
);

/** Trailing plain quantity: `Name 5`, `Name 5 pcs` */
const trailingPlain = new RegExp(
  `^(.*?)\\s+(\\d+)\\s*(?:${unitPattern})?\\.?$`,
  'i',
);

/** Leading quantity: `=2 Name`, `-5 Name`, `5 Name`, `5 - Name`, `5 = Name`, `5pcs Name` */
const leadingQtyRegex = new RegExp(
  `^[-=]*\\s*(\\d+)\\s*(?:${unitPattern})?\\s*[-=x*:]*\\s+(.+)$`,
  'i',
);

/** A cell that wraps only a quantity: `5`, `-5`, `=5`, `- 5`, `= 5`, `5 pcs`, `5-`, `-=5` */
const qtyCellRegex = new RegExp(
  `^[-=]*\\s*(\\d+)\\s*(?:${unitPattern})?[-=]*$`,
  'i',
);

const extractQtyNumber = (token: string): number => {
  const match = token.match(/\d+/);
  return match ? Number(match[0]) : 0;
};

interface BrandRule {
  brand: string;
  keys: string[];
}

/**
 * Known mobile brands the list is filed under.
 * Prioritize multi-word or longer names before shorter prefixes (e.g. Redmi before Mi).
 */
const BRAND_RULES: BrandRule[] = [
  { brand: 'OnePlus', keys: ['oneplus', 'one plus', '1+'] },
  { brand: 'Realme', keys: ['realme'] },
  { brand: 'Redmi', keys: ['redmi'] },
  { brand: 'Xiaomi', keys: ['xiaomi'] },
  { brand: 'Poco', keys: ['poco'] },
  { brand: 'Oppo', keys: ['oppo'] },
  { brand: 'Vivo', keys: ['vivo'] },
  { brand: 'Samsung', keys: ['samsung', 'galaxy'] },
  { brand: 'Apple', keys: ['apple', 'iphone', 'ipad', 'ipod'] },
  { brand: 'Nokia', keys: ['nokia'] },
  { brand: 'Motorola', keys: ['motorola', 'moto'] },
  { brand: 'Infinix', keys: ['infinix'] },
  { brand: 'Tecno', keys: ['tecno'] },
  { brand: 'Itel', keys: ['itel'] },
  { brand: 'Lenovo', keys: ['lenovo'] },
  { brand: 'Sony', keys: ['sony', 'xperia'] },
  { brand: 'Google', keys: ['google', 'pixel'] },
  { brand: 'Nothing', keys: ['nothing'] },
  { brand: 'iQOO', keys: ['iqoo'] },
  { brand: 'Huawei', keys: ['huawei'] },
  { brand: 'Honor', keys: ['honor'] },
  { brand: 'Micromax', keys: ['micromax'] },
  { brand: 'Lava', keys: ['lava'] },
  { brand: 'Jio', keys: ['jio', 'jiophone'] },
  { brand: 'Gionee', keys: ['gionee'] },
  { brand: 'Asus', keys: ['asus', 'rog'] },
  { brand: 'Mi', keys: ['mi'] },
];

/**
 * Shelf sections with mobile repair keywords and common phonetic misspellings.
 */
const CATEGORY_RULES: { category: string; keywords: string[]; regex?: RegExp }[] = [
  {
    category: 'Battery',
    // Phonetic & common variations: battery, batery, battry, bettery, bettry, betry, batt, btry, cell
    keywords: [
      'battery', 'batery', 'battry', 'bettery', 'bettry', 'betry', 'batt', 'btry',
      'mah', 'mobile battery', 'cell', 'li-ion', 'polymer',
    ],
    regex: /\b(b[ae]tt?[ae]?r[yi]|btry|batt)\b/i,
  },
  {
    category: 'Display',
    // Display, combo, folder, screen, lcd, oled, amoled, touch, touch folder
    keywords: [
      'display', 'disply', 'displey', 'screen', 'lcd', 'oled', 'amoled',
      'combo', 'folder', 'touch folder', 'touch screen', 'touch panel',
      'panel', 'combo og', 'folder og', 'glass only',
    ],
    regex: /\b(displ?[ae]y|screen|lcd|oled|amoled|combo|folder)\b/i,
  },
  {
    category: 'Tempered Glass',
    keywords: [
      'tempered', 'glass', 'guard', 'protector', 'film', '11d', '9d',
      '6d', 'uv glass', 'matte glass', 'screen guard', 'privacy glass',
    ],
  },
  {
    category: 'Back Cover',
    keywords: [
      'back cover', 'cover', 'back panel', 'housing', 'body', 'case',
      'back glass', 'back door', 'pouch', 'flip cover', 'cvr',
    ],
  },
  {
    category: 'Charger',
    keywords: [
      'charger', 'chargr', 'chager', 'adapter', 'cable', 'data cable',
      'type c', 'type-c', 'micro usb', 'v8 cable', 'lightning', 'fast charger',
      'power bank', 'wire',
    ],
  },
  {
    category: 'Earphone',
    keywords: [
      'earphone', 'earphones', 'earbud', 'earbuds', 'buds', 'headphone',
      'headphones', 'handsfree', 'neckband', 'bluetooth', 'airpods',
    ],
  },
  {
    category: 'Speaker',
    keywords: ['speaker', 'ringer', 'loud speaker', 'loudspeaker', 'receiver', 'earpiece', 'buzzer'],
  },
  {
    category: 'Mic',
    keywords: ['microphone', 'mic'],
  },
  {
    category: 'Camera',
    keywords: ['camera', 'lens', 'cam', 'front cam', 'back cam', 'camera glass'],
  },
  {
    category: 'Connector',
    keywords: [
      'connector', 'charging port', 'charging pin', 'cc board', 'cc pin',
      'cc flex', 'sub board', 'jack', 'audio jack', 'sim tray', 'sim slot',
      'simtray', 'antenna',
    ],
  },
  {
    category: 'Circuit',
    keywords: ['motherboard', 'mainboard', 'flex', 'main flex', 'pcb', 'ic', 'power ic', 'charging ic'],
  },
  {
    category: 'Button',
    keywords: ['button', 'power button', 'volume button', 'on off key', 'switch', 'outer key'],
  },
];

/** The brand a name starts with or sounds like, or '' when nothing matches. */
export function detectBrand(name: string): string {
  if (!name.trim()) return '';
  const key = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const rule of BRAND_RULES) {
    for (const token of rule.keys) {
      if (key.includes(` ${token} `)) return rule.brand;
    }
  }
  return '';
}

/** The shelf section a name belongs in, or 'Repair Part' for everyday items. */
export function detectCategory(name: string): string {
  if (!name.trim()) return 'Repair Part';
  const clean = name.trim();
  const key = ` ${clean.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

  for (const rule of CATEGORY_RULES) {
    if (rule.regex && rule.regex.test(clean)) return rule.category;
    for (const kw of rule.keywords) {
      const token = ` ${kw.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
      if (key.includes(token)) return rule.category;
    }
  }
  return 'Repair Part';
}

function cleanItemName(name: string): string {
  return name
    .replace(/^[-=:,/|•*]+\s*/, '')
    .replace(/\s*[-=:,/|]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitCells(line: string): string[] {
  return line.split(/[,;\t]+/).map((cell) => cell.trim()).filter(Boolean);
}

/** Picks the numeric cell out of a sheet row. */
function sheetQuantity(cells: string[]): { name: string; quantity: number } | null {
  if (cells.length < 2) return null;
  const first = cells[0] ?? '';
  const last = cells[cells.length - 1] ?? '';

  if (qtyCellRegex.test(last) && !qtyCellRegex.test(first)) {
    return {
      name: cleanItemName(cells.slice(0, -1).join(' ')),
      quantity: extractQtyNumber(last),
    };
  }
  if (qtyCellRegex.test(first) && !qtyCellRegex.test(last)) {
    return {
      name: cleanItemName(cells.slice(1).join(' ')),
      quantity: extractQtyNumber(first),
    };
  }
  return null;
}

/**
 * Organizes stock rows hierarchically: Brand -> Category Section -> Items
 */
export function groupStockByBrandAndCategory(rows: StockImportRow[]): StockBrandGroup[] {
  const brandMap = new Map<string, Map<string, StockImportRow[]>>();

  for (const row of rows) {
    const brandKey = row.brand.trim() || 'No Brand';
    const catKey = row.category.trim() || 'Repair Part';

    let catMap = brandMap.get(brandKey);
    if (!catMap) {
      catMap = new Map<string, StockImportRow[]>();
      brandMap.set(brandKey, catMap);
    }

    const list = catMap.get(catKey) ?? [];
    list.push(row);
    catMap.set(catKey, list);
  }

  const result: StockBrandGroup[] = [];

  for (const [brand, catMap] of brandMap.entries()) {
    const categories: StockCategoryGroup[] = [];
    let brandUnits = 0;
    let brandItems = 0;

    for (const [category, itemRows] of catMap.entries()) {
      const catUnits = itemRows.reduce((sum, r) => sum + r.quantity, 0);
      brandUnits += catUnits;
      brandItems += itemRows.length;
      categories.push({
        category,
        rows: itemRows,
        totalUnits: catUnits,
      });
    }

    result.push({
      brand,
      categories,
      totalItems: brandItems,
      totalUnits: brandUnits,
    });
  }

  return result;
}

export function isPureBrandHeading(name: string): boolean {
  const clean = name.trim().toLowerCase();
  for (const rule of BRAND_RULES) {
    if (rule.brand.toLowerCase() === clean) return true;
    for (const key of rule.keys) {
      if (key.toLowerCase() === clean) return true;
    }
  }
  return false;
}

/**
 * Finds the best matching available stock item from the shelf.
 * Auto-selects exact matches, normalized matches, or token-based matches.
 */
export function findBestMatchingPart(
  rawName: string,
  brand: string,
  availableParts?: PartListItem[],
): PartListItem | null {
  if (!availableParts || availableParts.length === 0 || !rawName.trim()) return null;

  const clean = rawName.trim().toLowerCase();
  const cleanBrand = brand.trim().toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanNorm = norm(clean);
  const combinedNorm = norm(`${cleanBrand} ${clean}`);

  // 1. Exact match on part.name
  const exact = availableParts.find(
    (p) =>
      p.name.trim().toLowerCase() === clean &&
      (!cleanBrand || p.brand.trim().toLowerCase() === cleanBrand),
  );
  if (exact) return exact;

  const exactNameOnly = availableParts.find(
    (p) => p.name.trim().toLowerCase() === clean,
  );
  if (exactNameOnly) return exactNameOnly;

  // 2. Normalized full string match (e.g. brand + name combined)
  const normMatch = availableParts.find((p) => {
    const pNorm = norm(p.name);
    const pCombined = norm(`${p.brand} ${p.name}`);
    return (
      pNorm === cleanNorm ||
      pNorm === combinedNorm ||
      pCombined === cleanNorm ||
      pCombined === combinedNorm
    );
  });
  if (normMatch) return normMatch;

  // 3. Token-based overlap match (e.g., "M30 Display" matching "Samsung M30 Display")
  const tokens = clean
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (tokens.length >= 2) {
    let bestCandidate: PartListItem | null = null;
    let maxMatchedTokens = 0;

    for (const p of availableParts) {
      const pText = `${p.brand} ${p.name} ${p.model}`.toLowerCase();
      let matchedCount = 0;
      for (const t of tokens) {
        if (pText.includes(t)) matchedCount++;
      }

      if (matchedCount >= 2 && matchedCount > maxMatchedTokens) {
        maxMatchedTokens = matchedCount;
        bestCandidate = p;
      }
    }

    if (bestCandidate && maxMatchedTokens >= Math.ceil(tokens.length * 0.7)) {
      return bestCandidate;
    }
  }

  return null;
}

export function parseStockList(text: string, availableParts?: PartListItem[]): StockImportPlan {
  const rows: StockImportRow[] = [];
  const brands: string[] = [];
  const skipped: string[] = [];
  let currentBrand = '';

  const push = (rawName: string, quantity: number): void => {
    const clean = cleanItemName(rawName);
    if (!clean) {
      skipped.push(`${rawName} ${quantity}`);
      return;
    }
    if (!Number.isInteger(quantity) || quantity > MAX_QUANTITY || quantity < 0) {
      skipped.push(`${rawName} ${quantity}`);
      return;
    }

    const detectedB = detectBrand(clean);
    const initialBrand = currentBrand || detectedB;
    const initialCategory = detectCategory(clean);

    // Auto-select available stock item if matching
    const matched = findBestMatchingPart(clean, initialBrand, availableParts);

    rows.push({
      name: clean,
      brand: matched?.brand || initialBrand,
      category: matched?.category || initialCategory,
      quantity,
      partId: matched?.id,
      matchedPartName: matched?.name,
      currentStock: matched?.quantity,
    });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(bulletStart, '').trim();
    if (!line) continue;

    // Check for sheet formats (comma, tab, semicolon)
    if (/[,;\t]/.test(line)) {
      const cells = splitCells(line);
      if (cells.length === 1) {
        const cell = cells[0] ?? '';
        const matchSep = cell.match(trailingWithSeparator);
        const matchLead = cell.match(leadingQtyRegex);
        const matchPlain = cell.match(trailingPlain);

        if (matchSep && matchSep[1]?.trim()) {
          push(matchSep[1], extractQtyNumber(matchSep[2]!));
        } else if (matchLead && matchLead[2]?.trim()) {
          push(matchLead[2], extractQtyNumber(matchLead[1]!));
        } else if (matchPlain && matchPlain[1]?.trim()) {
          push(matchPlain[1], extractQtyNumber(matchPlain[2]!));
        } else if (isPureBrandHeading(cell)) {
          currentBrand = cleanItemName(cell);
          if (currentBrand) brands.push(currentBrand);
        } else {
          // Line without quantity -> default quantity 1
          push(cell, 1);
        }
        continue;
      }

      const sheet = sheetQuantity(cells);
      if (sheet) {
        push(sheet.name, sheet.quantity);
      } else {
        const combined = cells.join(' ');
        if (isPureBrandHeading(combined)) {
          currentBrand = cleanItemName(combined);
          if (currentBrand) brands.push(currentBrand);
        } else {
          push(combined, 1);
        }
      }
      continue;
    }

    // Line format:
    // 1) Separator followed by quantity on the right side: "Oppo A15 Battery - 5", "= 5", "-5", ": 5"
    const matchSep = line.match(trailingWithSeparator);
    if (matchSep && matchSep[1]?.trim()) {
      push(matchSep[1], extractQtyNumber(matchSep[2]!));
      continue;
    }

    // 2) Leading quantity: "=2 Charger", "-5 Battery", "5 Charger", "5 - Charger"
    const matchLead = line.match(leadingQtyRegex);
    if (matchLead && matchLead[2]?.trim()) {
      push(matchLead[2], extractQtyNumber(matchLead[1]!));
      continue;
    }

    // 3) Plain trailing quantity with space: "Display 3", "Charger 5 pcs"
    const matchPlain = line.match(trailingPlain);
    if (matchPlain && matchPlain[1]?.trim()) {
      push(matchPlain[1], extractQtyNumber(matchPlain[2]!));
      continue;
    }

    // No quantity found -> check if pure brand heading or an item
    const cleanLine = cleanItemName(line);
    if (isPureBrandHeading(cleanLine)) {
      currentBrand = cleanLine;
      brands.push(currentBrand);
    } else if (cleanLine) {
      // It's an item pasted by name without explicit quantity -> default quantity 1
      push(cleanLine, 1);
    }
  }

  const grouped = groupStockByBrandAndCategory(rows);

  return { rows, brands, skipped, grouped };
}