from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


GRID_BLOCKS = 30
ROAD_WIDTH = 124
SIDEWALK_WIDTH = 26
BLOCK_WIDTH_CHOICES = (250, 310, 370, 440, 290, 410)
BLOCK_HEIGHT_CHOICES = (250, 320, 380, 280, 430, 350)

BUILDING_PREFIXES = ('CASA-', 'COM-')
ROAD_PREFIX = 'RUA-'
PLAZA_PREFIX = 'PRACA-'
HOSPITAL_PREFIX = 'HOSP-'
CODE_RE = re.compile(r'^(RUA|CASA|COM|PRACA|HOSP)-\d+$')


@dataclass(frozen=True)
class CityLocationMeta:
    code: str
    default_name: str
    kind: str  # 'RUA' | 'CASA' | 'COM' | 'PRACA' | 'HOSP'
    grid_x: int = 0
    grid_y: int = 0
    x: float = 0.0
    y: float = 0.0
    w: float = 0.0
    h: float = 0.0

    @property
    def is_building(self) -> bool:
        return self.kind in ('CASA', 'COM')


@dataclass(frozen=True)
class CityBlockMeta:
    bx: int
    by: int
    x: float
    y: float
    w: float
    h: float
    is_plaza: bool


@dataclass(frozen=True)
class OfficialCityLayout:
    world_width: float
    world_height: float
    blocks: tuple[CityBlockMeta, ...]
    locations: dict[str, tuple[str, int, int, float, float, float, float]]  # code -> (kind, bx, by, x, y, w, h)


def infer_location_kind(code: str) -> str:
    upper = code.strip().upper()
    if upper.startswith(ROAD_PREFIX):
        return 'RUA'
    if upper.startswith('CASA-'):
        return 'CASA'
    if upper.startswith('COM-'):
        return 'COM'
    if upper.startswith(PLAZA_PREFIX):
        return 'PRACA'
    if upper.startswith(HOSPITAL_PREFIX):
        return 'HOSP'
    return ''


def is_building_code(code: str) -> bool:
    upper = code.strip().upper()
    return upper.startswith(BUILDING_PREFIXES)


def _to_uint32_js(val: float | int) -> int:
    """Simula `val >>> 0` do JavaScript (inclusive arredondamento IEEE-754 float64)."""
    return int(float(val)) & 0xFFFFFFFF


def _to_int32_js(val: int) -> int:
    v = val & 0xFFFFFFFF
    return v - 0x100000000 if v >= 0x80000000 else v


def _hash_block(bx: int, by: int) -> int:
    """Reproduz exatamente `hashBlock(bx, by)` de app/src/world/city-layout.js."""
    h = _to_int32_js(bx * 73856093) ^ _to_int32_js(by * 19349663)
    h_u = h & 0xFFFFFFFF
    h = _to_uint32_js(float((h_u >> 16) ^ h) * float(0x45D9F3B))
    h = ((h >> 16) ^ h) & 0xFFFFFFFF
    return h


def compute_official_city_layout() -> OfficialCityLayout:
    """Reproduz exatamente a geometria da cidade-base de app/src/world/city-map.js."""
    col_widths = [
        BLOCK_WIDTH_CHOICES[_hash_block(i + 3, 17) % len(BLOCK_WIDTH_CHOICES)]
        for i in range(GRID_BLOCKS)
    ]
    row_heights = [
        BLOCK_HEIGHT_CHOICES[_hash_block(29, i + 5) % len(BLOCK_HEIGHT_CHOICES)]
        for i in range(GRID_BLOCKS)
    ]

    road_x_offsets: list[int] = []
    block_x_offsets: list[int] = []
    cx = 0
    for i in range(GRID_BLOCKS):
        road_x_offsets.append(cx)
        cx += ROAD_WIDTH
        block_x_offsets.append(cx)
        cx += col_widths[i]
    road_x_offsets.append(cx)
    world_width = float(cx + ROAD_WIDTH)

    road_y_offsets: list[int] = []
    block_y_offsets: list[int] = []
    cy = 0
    for i in range(GRID_BLOCKS):
        road_y_offsets.append(cy)
        cy += ROAD_WIDTH
        block_y_offsets.append(cy)
        cy += row_heights[i]
    road_y_offsets.append(cy)
    world_height = float(cy + ROAD_WIDTH)

    locations: dict[str, tuple[str, int, int, float, float, float, float]] = {}

    # Ruas horizontais e verticais
    road_idx = 1
    for row in range(GRID_BLOCKS + 1):
        code = f'RUA-{road_idx:03d}'
        road_idx += 1
        locations[code] = ('RUA', 0, row, 0.0, float(road_y_offsets[row]), world_width, float(ROAD_WIDTH))

    for col in range(GRID_BLOCKS + 1):
        code = f'RUA-{road_idx:03d}'
        road_idx += 1
        locations[code] = ('RUA', col, 0, float(road_x_offsets[col]), 0.0, float(ROAD_WIDTH), world_height)

    # Quarteirões, praças e edificações
    house_idx = 1
    commerce_idx = 1
    plaza_idx = 1

    def next_code(btype: str) -> str:
        nonlocal house_idx, commerce_idx
        if btype == 'commerce':
            c = f'COM-{commerce_idx:03d}'
            commerce_idx += 1
            return c
        c = f'CASA-{house_idx:03d}'
        house_idx += 1
        return c

    blocks_meta: list[CityBlockMeta] = []
    # Para replicar #placeHospitals(), guardamos lista mutável de prédios por bloco [by][bx]
    block_buildings: list[list[list[tuple[str, str, float, float, float, float]]]] = []
    block_is_plaza: list[list[bool]] = []

    for by in range(GRID_BLOCKS):
        row_b: list[list[tuple[str, str, float, float, float, float]]] = []
        row_p: list[bool] = []
        for bx in range(GRID_BLOCKS):
            block_x = block_x_offsets[bx]
            block_y = block_y_offsets[by]
            bw = col_widths[bx]
            bh = row_heights[by]
            seed = _hash_block(bx, by)
            is_plaza = (bx % 5 == 2) and (by % 5 == 2)
            blocks_meta.append(
                CityBlockMeta(
                    bx=bx,
                    by=by,
                    x=float(block_x),
                    y=float(block_y),
                    w=float(bw),
                    h=float(bh),
                    is_plaza=is_plaza,
                )
            )
            row_p.append(is_plaza)
            buildings: list[tuple[str, str, float, float, float, float]] = []

            if is_plaza:
                code = f'PRACA-{plaza_idx:03d}'
                plaza_idx += 1
                inner_x = float(block_x + SIDEWALK_WIDTH)
                inner_y = float(block_y + SIDEWALK_WIDTH)
                inner_w = float(bw - SIDEWALK_WIDTH * 2)
                inner_h = float(bh - SIDEWALK_WIDTH * 2)
                locations[code] = ('PRACA', bx, by, inner_x, inner_y, inner_w, inner_h)
            else:
                pad = SIDEWALK_WIDTH + 6
                inner_w = bw - pad * 2
                inner_h = bh - pad * 2
                layout_style = seed % 4

                if layout_style == 0 and inner_w >= 180 and inner_h >= 180:
                    b_type = 'commerce' if ((seed >> 2) % 2 == 0) else 'house'
                    b_w = int(inner_w * 0.78)
                    b_h = int(inner_h * 0.72)
                    offset_x = 0 if (seed % 3 == 0) else (inner_w - b_w)
                    code = next_code(b_type)
                    kind = 'COM' if b_type == 'commerce' else 'CASA'
                    entry = (code, kind, float(block_x + pad + offset_x), float(block_y + pad), float(b_w), float(b_h))
                    buildings.append(entry)
                    locations[code] = (kind, bx, by, entry[2], entry[3], entry[4], entry[5])
                elif layout_style == 1 and inner_w >= 260:
                    gap = 16
                    top_h = int((inner_h - gap) * 0.45)
                    bot_h = inner_h - gap - top_h
                    left_w = int((inner_w - gap) * 0.44)
                    right_w = inner_w - gap - left_w

                    c1 = next_code('house')
                    e1 = (c1, 'CASA', float(block_x + pad), float(block_y + pad), float(left_w), float(top_h))
                    c2 = next_code('commerce')
                    e2 = (c2, 'COM', float(block_x + pad + left_w + gap), float(block_y + pad), float(right_w), float(top_h))
                    b3_type = 'commerce' if ((seed >> 4) % 2 == 0) else 'house'
                    c3 = next_code(b3_type)
                    k3 = 'COM' if b3_type == 'commerce' else 'CASA'
                    e3 = (c3, k3, float(block_x + pad), float(block_y + pad + top_h + gap), float(inner_w), float(bot_h))

                    for entry in (e1, e2, e3):
                        buildings.append(entry)
                        locations[entry[0]] = (entry[1], bx, by, entry[2], entry[3], entry[4], entry[5])
                elif layout_style == 2:
                    gap = 16
                    left_w = int((inner_w - gap) * 0.56)
                    right_w = inner_w - gap - left_w
                    c1 = next_code('commerce')
                    e1 = (c1, 'COM', float(block_x + pad), float(block_y + pad), float(left_w), float(inner_h))
                    c2 = next_code('house')
                    e2 = (c2, 'CASA', float(block_x + pad + left_w + gap), float(block_y + pad + 14), float(right_w), float(inner_h - 28))
                    for entry in (e1, e2):
                        buildings.append(entry)
                        locations[entry[0]] = (entry[1], bx, by, entry[2], entry[3], entry[4], entry[5])
                else:
                    gap = 18
                    top_h = int((inner_h - gap) * 0.44)
                    bot_h = inner_h - gap - top_h
                    top_type = 'commerce' if (seed % 3 == 0) else 'house'
                    bot_type = 'commerce' if ((seed >> 2) % 2 == 0) else 'house'
                    c1 = next_code(top_type)
                    k1 = 'COM' if top_type == 'commerce' else 'CASA'
                    e1 = (c1, k1, float(block_x + pad + 12), float(block_y + pad), float(inner_w - 24), float(top_h))
                    c2 = next_code(bot_type)
                    k2 = 'COM' if bot_type == 'commerce' else 'CASA'
                    e2 = (c2, k2, float(block_x + pad), float(block_y + pad + top_h + gap), float(inner_w), float(bot_h))
                    for entry in (e1, e2):
                        buildings.append(entry)
                        locations[entry[0]] = (entry[1], bx, by, entry[2], entry[3], entry[4], entry[5])

            row_b.append(buildings)
        block_buildings.append(row_b)
        block_is_plaza.append(row_p)

    # Hospitais (#placeHospitals)
    protected_codes = {
        'CASA-001', 'CASA-002', 'COM-001', 'COM-024',
        'COM-320', 'CASA-353', 'COM-554', 'CASA-656',
    }
    offsets = ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1))
    used_blocks: set[tuple[int, int]] = set()
    cols = 8
    rows = 5
    hosp_idx = 1

    for row in range(rows):
        for col in range(cols):
            base_bx = int(((col + 0.5) * GRID_BLOCKS) / cols)
            base_by = int(((row + 0.5) * GRID_BLOCKS) / rows)
            placed = False

            for dx, dy in offsets:
                bx = base_bx + dx
                by = base_by + dy
                if not (0 <= bx < GRID_BLOCKS and 0 <= by < GRID_BLOCKS):
                    continue
                if (bx, by) in used_blocks or block_is_plaza[by][bx]:
                    continue
                b_list = block_buildings[by][bx]
                if not b_list:
                    continue

                target_idx = -1
                best_area = -1.0
                for i, cand in enumerate(b_list):
                    if cand[0] in protected_codes:
                        continue
                    area = cand[4] * cand[5]
                    if area > best_area:
                        best_area = area
                        target_idx = i
                if target_idx == -1:
                    continue

                orig = b_list[target_idx]
                h_code = f'HOSP-{hosp_idx:03d}'
                hosp_idx += 1
                hosp_entry = (h_code, 'HOSP', orig[2], orig[3], orig[4], orig[5])
                b_list[target_idx] = hosp_entry
                locations.pop(orig[0], None)
                locations[h_code] = ('HOSP', bx, by, orig[2], orig[3], orig[4], orig[5])
                used_blocks.add((bx, by))
                placed = True
                break

            if not placed:
                for by in range(GRID_BLOCKS):
                    if placed:
                        break
                    for bx in range(GRID_BLOCKS):
                        if (bx, by) in used_blocks or block_is_plaza[by][bx]:
                            continue
                        b_list = block_buildings[by][bx]
                        if not b_list:
                            continue
                        target_idx = next(
                            (i for i, cand in enumerate(b_list) if cand[0] not in protected_codes),
                            -1,
                        )
                        if target_idx == -1:
                            continue
                        orig = b_list[target_idx]
                        h_code = f'HOSP-{hosp_idx:03d}'
                        hosp_idx += 1
                        hosp_entry = (h_code, 'HOSP', orig[2], orig[3], orig[4], orig[5])
                        b_list[target_idx] = hosp_entry
                        locations.pop(orig[0], None)
                        locations[h_code] = ('HOSP', bx, by, orig[2], orig[3], orig[4], orig[5])
                        used_blocks.add((bx, by))
                        placed = True
                        break

    return OfficialCityLayout(
        world_width=world_width,
        world_height=world_height,
        blocks=tuple(blocks_meta),
        locations=locations,
    )


_CACHED_LAYOUT: OfficialCityLayout | None = None


def get_official_city_layout() -> OfficialCityLayout:
    global _CACHED_LAYOUT
    if _CACHED_LAYOUT is None:
        _CACHED_LAYOUT = compute_official_city_layout()
    return _CACHED_LAYOUT


def load_canonical_city_locations(app_root: Path) -> dict[str, CityLocationMeta]:
    """Carrega todos os códigos canônicos da cidade-base com coordenadas oficiais do mapa do jogo."""
    locations: dict[str, CityLocationMeta] = {}
    ref_map = app_root / 'story' / 'vibe-coding' / 'map' / 'map.md'
    if not ref_map.is_file():
        return locations

    layout = get_official_city_layout()

    for raw_line in ref_map.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or line.startswith('<!--'):
            continue
        if line.startswith('- '):
            line = line[2:].strip()
        if ':' not in line:
            continue
        code_part, rest = line.split(':', 1)
        code = code_part.strip().upper()
        name = rest.split('|', 1)[0].strip()
        if not CODE_RE.match(code) or not name:
            continue

        kind = infer_location_kind(code)
        geom = layout.locations.get(code)
        if geom:
            _, gx, gy, x, y, w, h = geom
        else:
            gx, gy, x, y, w, h = 0, 0, 0.0, 0.0, 0.0, 0.0

        locations[code] = CityLocationMeta(
            code=code,
            default_name=name,
            kind=kind,
            grid_x=gx,
            grid_y=gy,
            x=x,
            y=y,
            w=w,
            h=h,
        )
    return locations
