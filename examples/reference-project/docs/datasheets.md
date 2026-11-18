# Datasheet cache

Vendor PDFs are copyright-protected, so they are **not committed**: they live in
`external/cache/` (gitignored, ADR-0008). This file is the index — which cached file serves
which component, and which vendor document it is. Download the file yourself from the vendor
site; the `datasheet` field of a component file records only the original URL.

Components are always built from the datasheet: pins, ratings and parameters are read off the
cached copy, never from memory or a second-hand page.

## Cached files

| Component | Cache file | Vendor document |
|---|---|---|
| `bq24610rger` | `bq24610.pdf` | TI SLUS892D |
| `tps5430ddar` | `tps5430.pdf` | TI SLVS632L (2006-01, rev. 2026-04) |
| `tps7a2033pdbvr` | `tps7a20.pdf` | TI SBVS338H |
| `ch32v307vct6` | `CH32V307DS0.pdf` | WCH V3.9 (CH32V303/305/307/317) |
| `xtal-8mhz-3225` | `SST-3225-8M-12PF-10PPM.pdf` | Sichuan Sorst approval sheet |
| `sw-ts-1187` | `TS-1187.pdf` | Shuofang Precision TS-1187 series specification |
| `q-si7617dn` | `si7617dn.pdf` | Vishay 65164 (S15-1032-Rev. B, 2015-05-04) |
| `q-sis412dn` | `sis412dn.pdf` | Vishay 69006 (S09-0135-Rev. C, 2009-02-02) |
| `d-b340a` | `DS30891.pdf` | Diodes Incorporated DS30891 (B320A–B360A family) |
| `d-bat54c` | `bat54-d.pdf` | onsemi BAT54 series (2017-09, Rev. 3) |
| `dc-005-a200` | `DC-005-A200.pdf` | Xun Pu `DC-005` series drawing (the product page is the `datasheet` field) |
| `ltst-c190gkt` | `LTST-C190GKT.pdf` | Lite-On DS-22-98-0011 (Rev. H, 2021-10-19) |

## Two vendor documents that disagree

- `dc-005-a200` — Xun Pu publishes **two** documents for the `DC-005` series, and they do not
  agree on the current:

  | Document | Current | Voltage |
  |---|---|---|
  | the product page (`https://www.xunpu.com.cn/product/458.html`) | 2 A | 30 V DC |
  | the series drawing (`DC-005-A200.pdf`) | 3 A | 30 V DC |

  The component file takes the **lower** number, 2 A, and says which document it came from
  ([ADR-0077](../../../docs/adr/07-devices/0077-a-jack-and-an-led-are-classes.md) D6). A design
  must not sit on the higher of two numbers a vendor publishes for one part: the lower one is the
  one both documents agree survives. The product page is also the `datasheet` field, because it is
  the vendor's own statement about the part; the drawing is the source of the pin table and the
  land pattern.

  The cached drawing is named after the part, because that is the vendor's own name for it. The
  series page numbers the variants by plug size: `DC-005-A200` is the 2.0 mm one, `DC-005-A250`
  the 2.5 mm one.

## A part number that was not an identity

- `dc-005-20a` — **deleted** (2026-11-18). The string `DC-005-20A` names two different drawings
  (a 2013 one and a 2021 one) with different PCB layouts and different ratings (0.5 A / 30 V
  against 3 A / 24 V), and the series name `DC-005` is used by at least two manufacturers, each
  with its own drawing. A number that names two drawings is not the identity of a device. The
  design now states what it needs (`dc-jack-th`) and the procurement layer names the part
  (`dc-005-a200`). The round that recorded this is
  `docs/reviews/2026-11-18-charger-buck-sch-r3.md`.

## A part that turned out not to exist

- `q-si7616dn` — **no such part was found**, so the component file was **deleted** (2026-11-18)
  and the instance that used it (Q2, the second input FET) now uses `q-si7617dn`. Vishay's
  `Si76xxDN` family runs Si7611DN, Si7613DN, Si7615DN/ADN/BDN/CDN, Si7617DN and Si7619DN; every
  family datasheet in Vishay's document range 64700–65300 was checked and none is a `Si7616DN`,
  and no distributor lists the part number. Giving the file its neighbour's ratings would have put
  numbers in the design that no datasheet supports. The round that recorded this is
  `docs/reviews/2026-11-18-charger-buck-sch-r2.md`.

## Notes

- The file name in the cache is the vendor's own document or product name, so a cache file can
  be traced back to the vendor site without this table (for example `bat54-d.pdf` is onsemi's
  `bat54-d.pdf`).
- Vishay moves file names without moving document numbers; `https://www.vishay.com/doc?<number>`
  always redirects to the current file for that document.
