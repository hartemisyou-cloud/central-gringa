/**
 * Hope Human Books catalog manifest (generated from docs/catalog/hope-human-books-provenance.json).
 * Single source of truth for which files each SKU delivers. Prices here are mirrored in the
 * database seed; the database row is what the order API charges.
 */
export const HHB_STORE_ID = "b0b5e000-4848-4b00-8000-000000000001";
export const HHB_STORE_SLUG = "hope-human-books";
export const EBOOK_BUCKET = "ebooks";
export const EBOOK_PREFIX = "v1/";

export interface HhbWork {
  workId: string;
  title: string;
  author: string;
  firstPublished: string;
  sourceUrl: string;
  sourceEbookNumber: number;
  file: string;
  bytes: number;
  sha256: string;
  copyrightStatus: string;
}

export interface HhbProduct {
  id: string;
  sku: string;
  slug: string;
  name: string;
  priceCents: number;
  category: "ebook" | "collection";
  description: string;
  workIds: string[];
}

export const HHB_WORKS: HhbWork[] = [
  {
    "workId": "the-yellow-wallpaper",
    "title": "The Yellow Wallpaper",
    "author": "Charlotte Perkins Gilman",
    "firstPublished": "1892",
    "sourceUrl": "https://www.gutenberg.org/ebooks/1952",
    "sourceEbookNumber": 1952,
    "file": "the-yellow-wallpaper.txt",
    "bytes": 32233,
    "sha256": "fcf771d7dd7a657bee0200f65a44a0bf479b616c8cfa8f6294859bc4b1b130e2",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "the-call-of-the-wild",
    "title": "The Call of the Wild",
    "author": "Jack London",
    "firstPublished": "1903",
    "sourceUrl": "https://www.gutenberg.org/ebooks/215",
    "sourceEbookNumber": 215,
    "file": "the-call-of-the-wild.txt",
    "bytes": 177180,
    "sha256": "28fae3de42cbb92a9a92ebecb65605dc907cc8a73e69c744fca48bfd0ad33c48",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "the-four-million",
    "title": "The Four Million",
    "author": "O. Henry",
    "firstPublished": "1906",
    "sourceUrl": "https://www.gutenberg.org/ebooks/2776",
    "sourceEbookNumber": 2776,
    "file": "the-four-million.txt",
    "bytes": 297051,
    "sha256": "3b5383d55212c298aade8456043feec9b34a16c0183277c56b5f21ca85dba9af",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "the-adventures-of-tom-sawyer",
    "title": "The Adventures of Tom Sawyer",
    "author": "Mark Twain",
    "firstPublished": "1876",
    "sourceUrl": "https://www.gutenberg.org/ebooks/74",
    "sourceEbookNumber": 74,
    "file": "the-adventures-of-tom-sawyer.txt",
    "bytes": 403071,
    "sha256": "91c92b8e8d9a82577737fdf53def65c2c5a5216db2752da716bc1b18007b3ba5",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "little-women",
    "title": "Little Women",
    "author": "Louisa May Alcott",
    "firstPublished": "1868–1869",
    "sourceUrl": "https://www.gutenberg.org/ebooks/514",
    "sourceEbookNumber": 514,
    "file": "little-women.txt",
    "bytes": 1031192,
    "sha256": "b2ff0d03b4b1824c1e4cb9b24a3da93012012431f9f8185146bade0749d97cff",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "adventures-of-huckleberry-finn",
    "title": "Adventures of Huckleberry Finn",
    "author": "Mark Twain",
    "firstPublished": "1884–1885",
    "sourceUrl": "https://www.gutenberg.org/ebooks/76",
    "sourceEbookNumber": 76,
    "file": "adventures-of-huckleberry-finn.txt",
    "bytes": 587364,
    "sha256": "1a814b20dc9b890c7888a7228a37d7a5b137e358502fb4a70cf9de878cf3592e",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "walden-and-civil-disobedience",
    "title": "Walden, and On the Duty of Civil Disobedience",
    "author": "Henry David Thoreau",
    "firstPublished": "1854 / 1849",
    "sourceUrl": "https://www.gutenberg.org/ebooks/205",
    "sourceEbookNumber": 205,
    "file": "walden-and-civil-disobedience.txt",
    "bytes": 638194,
    "sha256": "f331822ef03d371f7689f684e4c58958fbb37feb0865d0a2f9e7fce3473fe7bb",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "moby-dick",
    "title": "Moby-Dick; or, The Whale",
    "author": "Herman Melville",
    "firstPublished": "1851",
    "sourceUrl": "https://www.gutenberg.org/ebooks/2701",
    "sourceEbookNumber": 2701,
    "file": "moby-dick.txt",
    "bytes": 1234484,
    "sha256": "5518215e13ef43f90eb0e32c432876e9242c15093b8f947fbcfbf2a33d0ec9f9",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "the-wonderful-wizard-of-oz",
    "title": "The Wonderful Wizard of Oz",
    "author": "L. Frank Baum",
    "firstPublished": "1900",
    "sourceUrl": "https://www.gutenberg.org/ebooks/55",
    "sourceEbookNumber": 55,
    "file": "the-wonderful-wizard-of-oz.txt",
    "bytes": 213009,
    "sha256": "d22fe76a82087d271c5612b66408664532e2283a563d5d1c9d85bd65b3d69883",
    "copyrightStatus": "Public domain in the United States"
  },
  {
    "workId": "the-scarlet-letter",
    "title": "The Scarlet Letter",
    "author": "Nathaniel Hawthorne",
    "firstPublished": "1850",
    "sourceUrl": "https://www.gutenberg.org/ebooks/33",
    "sourceEbookNumber": 33,
    "file": "the-scarlet-letter.txt",
    "bytes": 486061,
    "sha256": "b17aba190db4256c49f5807e5740e596ed321e81890f7f1a92bf72f4c7a6d69b",
    "copyrightStatus": "Public domain in the United States"
  }
];

export const HHB_PRODUCTS: HhbProduct[] = [
  {
    "id": "b0b5e000-4848-4b00-8000-000000000101",
    "sku": "HHB-EB-005",
    "slug": "the-yellow-wallpaper",
    "name": "The Yellow Wallpaper — Charlotte Perkins Gilman",
    "priceCents": 500,
    "category": "ebook",
    "description": "Digital edition (plain text) of The Yellow Wallpaper by Charlotte Perkins Gilman, first published 1892. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "the-yellow-wallpaper"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000102",
    "sku": "HHB-EB-010",
    "slug": "the-call-of-the-wild",
    "name": "The Call of the Wild — Jack London",
    "priceCents": 1000,
    "category": "ebook",
    "description": "Digital edition (plain text) of The Call of the Wild by Jack London, first published 1903. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "the-call-of-the-wild"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000103",
    "sku": "HHB-EB-015",
    "slug": "the-four-million",
    "name": "The Four Million — O. Henry",
    "priceCents": 1500,
    "category": "ebook",
    "description": "Digital edition (plain text) of The Four Million by O. Henry, first published 1906. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "the-four-million"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000104",
    "sku": "HHB-EB-020",
    "slug": "the-adventures-of-tom-sawyer",
    "name": "The Adventures of Tom Sawyer — Mark Twain",
    "priceCents": 2000,
    "category": "ebook",
    "description": "Digital edition (plain text) of The Adventures of Tom Sawyer by Mark Twain, first published 1876. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "the-adventures-of-tom-sawyer"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000105",
    "sku": "HHB-EB-030",
    "slug": "little-women",
    "name": "Little Women — Louisa May Alcott",
    "priceCents": 3000,
    "category": "ebook",
    "description": "Digital edition (plain text) of Little Women by Louisa May Alcott, first published 1868–1869. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "little-women"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000106",
    "sku": "HHB-EB-050",
    "slug": "adventures-of-huckleberry-finn",
    "name": "Adventures of Huckleberry Finn — Mark Twain",
    "priceCents": 5000,
    "category": "ebook",
    "description": "Digital edition (plain text) of Adventures of Huckleberry Finn by Mark Twain, first published 1884–1885. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "adventures-of-huckleberry-finn"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000107",
    "sku": "HHB-EB-075",
    "slug": "walden-and-civil-disobedience",
    "name": "Walden, and On the Duty of Civil Disobedience — Henry David Thoreau",
    "priceCents": 7500,
    "category": "ebook",
    "description": "Digital edition (plain text) of Walden, and On the Duty of Civil Disobedience by Henry David Thoreau, first published 1854 / 1849. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "walden-and-civil-disobedience"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000108",
    "sku": "HHB-EB-100",
    "slug": "moby-dick",
    "name": "Moby-Dick — Herman Melville",
    "priceCents": 10000,
    "category": "ebook",
    "description": "Digital edition (plain text) of Moby-Dick; or, The Whale by Herman Melville, first published 1851. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "moby-dick"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000109",
    "sku": "HHB-EB-150",
    "slug": "the-wonderful-wizard-of-oz",
    "name": "The Wonderful Wizard of Oz — L. Frank Baum",
    "priceCents": 15000,
    "category": "ebook",
    "description": "Digital edition (plain text) of The Wonderful Wizard of Oz by L. Frank Baum, first published 1900. Original text only; no modern introduction or illustrations.",
    "workIds": [
      "the-wonderful-wizard-of-oz"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000110",
    "sku": "HHB-COL-250",
    "slug": "american-classics-collection",
    "name": "American Classics Collection — 6 ebooks",
    "priceCents": 25000,
    "category": "collection",
    "description": "Includes: The Adventures of Tom Sawyer (Mark Twain); Little Women (Louisa May Alcott); Adventures of Huckleberry Finn (Mark Twain); Moby-Dick (Herman Melville); The Call of the Wild (Jack London); Walden, and On the Duty of Civil Disobedience (Henry David Thoreau).",
    "workIds": [
      "the-adventures-of-tom-sawyer",
      "little-women",
      "adventures-of-huckleberry-finn",
      "moby-dick",
      "the-call-of-the-wild",
      "walden-and-civil-disobedience"
    ]
  },
  {
    "id": "b0b5e000-4848-4b00-8000-000000000111",
    "sku": "HHB-LIB-500",
    "slug": "american-classics-library",
    "name": "American Classics Library — 10 ebooks",
    "priceCents": 50000,
    "category": "collection",
    "description": "Includes: The Yellow Wallpaper (Charlotte Perkins Gilman); The Call of the Wild (Jack London); The Four Million (O. Henry); The Adventures of Tom Sawyer (Mark Twain); Little Women (Louisa May Alcott); Adventures of Huckleberry Finn (Mark Twain); Walden, and On the Duty of Civil Disobedience (Henry David Thoreau); Moby-Dick (Herman Melville); The Wonderful Wizard of Oz (L. Frank Baum); The Scarlet Letter (Nathaniel Hawthorne).",
    "workIds": [
      "the-yellow-wallpaper",
      "the-call-of-the-wild",
      "the-four-million",
      "the-adventures-of-tom-sawyer",
      "little-women",
      "adventures-of-huckleberry-finn",
      "walden-and-civil-disobedience",
      "moby-dick",
      "the-wonderful-wizard-of-oz",
      "the-scarlet-letter"
    ]
  }
];

const worksById = new Map(HHB_WORKS.map((w) => [w.workId, w]));
const productsBySku = new Map(HHB_PRODUCTS.map((p) => [p.sku, p]));

export function workById(id: string): HhbWork | undefined {
  return worksById.get(id);
}

export function worksForSku(sku: string): HhbWork[] {
  const product = productsBySku.get(sku);
  if (!product) return [];
  return product.workIds.map((id) => worksById.get(id)).filter((w): w is HhbWork => Boolean(w));
}

/** Unique works delivered by a set of purchased SKUs (bundles may overlap). */
export function worksForSkus(skus: string[]): HhbWork[] {
  const seen = new Map<string, HhbWork>();
  for (const sku of skus) for (const w of worksForSku(sku)) seen.set(w.workId, w);
  return [...seen.values()];
}
