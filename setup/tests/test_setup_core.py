from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
import unittest

from setup.core.city_catalog import load_canonical_city_locations
from setup.core.markdown_codec import (
    parse_item_markdown,
    parse_map_markdown,
    parse_mission_markdown,
    serialize_item_markdown,
    serialize_map_markdown,
    serialize_mission_markdown,
)
from setup.core.models import ExtraItemPlacement, Item, MapLocation
from setup.core.story_io import (
    StoryIOError,
    create_story,
    delete_story,
    import_asset_file,
    load_catalog,
    load_story_package,
    save_story_package,
)
from setup.core.validator import find_dependents, validate_story


APP_ROOT = Path(__file__).resolve().parents[2]


class SetupCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = Path(tempfile.mkdtemp(prefix='setup-test-'))
        self.app_copy = self.tmp_dir / 'app'
        (self.app_copy / 'story').mkdir(parents=True)
        shutil.copytree(APP_ROOT / 'story' / 'vibe-coding', self.app_copy / 'story' / 'vibe-coding')
        shutil.copytree(APP_ROOT / 'story' / '_template', self.app_copy / 'story' / '_template')
        shutil.copy2(APP_ROOT / 'story' / 'stories.json', self.app_copy / 'story' / 'stories.json')

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_load_and_validate_existing_vibe_coding_story(self) -> None:
        catalog = load_catalog(self.app_copy)
        self.assertGreaterEqual(len(catalog), 1)
        self.assertIn('vibe-coding', [e.id for e in catalog])

        pkg = load_story_package(self.app_copy, 'vibe-coding')
        self.assertEqual(pkg.title, 'GTA: Missão Vibe Coding')
        self.assertGreaterEqual(len(pkg.characters), 6)
        self.assertGreaterEqual(len(pkg.missions), 5)
        self.assertIn('extra-casa-hostnet', pkg.encounters)
        self.assertIn('CASA-063', pkg.locations)

        errors = validate_story(pkg, self.app_copy)
        self.assertEqual(errors, [])

    def test_create_save_and_delete_story_updates_catalog(self) -> None:
        template_pkg = load_story_package(self.app_copy, '_template')
        self.assertEqual(validate_story(template_pkg, self.app_copy), [])

        initial_ids = [e.id for e in load_catalog(self.app_copy)]
        pkg = create_story(self.app_copy, 'aventura-teste', 'Aventura de Teste', 'Descrição teste')
        self.assertEqual(pkg.id, 'aventura-teste')
        self.assertIn('01-exemplo', pkg.missions)
        self.assertIn('extra-exemplo', pkg.encounters)
        self.assertIn('item-chave', pkg.items)
        self.assertIn('item-extra', pkg.items)
        self.assertEqual(validate_story(pkg, self.app_copy), [])

        catalog = load_catalog(self.app_copy)
        self.assertEqual([e.id for e in catalog], initial_ids + ['aventura-teste'])

        pkg.title = 'Aventura Editada'
        save_story_package(self.app_copy, pkg)
        reloaded = load_story_package(self.app_copy, 'aventura-teste')
        self.assertEqual(reloaded.title, 'Aventura Editada')

        delete_story(self.app_copy, 'aventura-teste')
        catalog_after = load_catalog(self.app_copy)
        self.assertEqual([e.id for e in catalog_after], initial_ids)
        self.assertFalse((self.app_copy / 'story' / 'aventura-teste').exists())

    def test_find_dependents_blocks_unsafe_deletion_and_validate_catches_broken_refs(self) -> None:
        pkg = load_story_package(self.app_copy, 'vibe-coding')
        char_refs = find_dependents(pkg, 'character', 'guanabara')
        self.assertTrue(len(char_refs) > 0)

        item_refs = find_dependents(pkg, 'item', 'caixa-secreta')
        self.assertTrue(len(item_refs) > 0)

        # Quebra proposital: código de local inexistente, cor inválida em rua e marcador [ITEM-...] inválido
        pkg.missions['01-caixa-secreta'].target = 'CASA-9999'
        pkg.missions['01-caixa-secreta'].objective = 'Pegue [ITEM-inexistente] em [CASA-9999]'
        pkg.locations['RUA-001'].roof_color = '#123456'
        errors = validate_story(pkg, self.app_copy)
        self.assertTrue(any('CASA-9999' in err for err in errors))
        self.assertTrue(any('ITEM-inexistente' in err for err in errors))
        self.assertTrue(any('RUA-001' in err for err in errors))

    def test_map_roof_roundtrip_and_asset_import_validation(self) -> None:
        locs = {
            'RUA-001': MapLocation(code='RUA-001', name='Av. Central', kind='RUA'),
            'CASA-010': MapLocation(
                code='CASA-010',
                name='Casa Azul',
                kind='CASA',
                roof_color='#2563eb',
                roof_logo='assets/alex-front.svg',
            ),
        }
        serialized = serialize_map_markdown(locs)
        parsed = parse_map_markdown(serialized)
        self.assertEqual(parsed['CASA-010'].roof_color, '#2563eb')
        self.assertEqual(parsed['CASA-010'].roof_logo, 'assets/alex-front.svg')
        self.assertEqual(parsed['RUA-001'].name, 'Av. Central')

        bad_file = self.tmp_dir / 'script.exe'
        bad_file.write_text('x', encoding='utf-8')
        with self.assertRaises(StoryIOError):
            import_asset_file(self.app_copy / 'story' / 'vibe-coding', bad_file)

    def test_canonical_city_locations_match_official_map_coordinates(self) -> None:
        locs = load_canonical_city_locations(self.app_copy)
        casa_001 = locs['CASA-001']
        com_001 = locs['COM-001']
        praca_001 = locs['PRACA-001']
        hosp_001 = locs['HOSP-001']

        self.assertEqual((casa_001.grid_x, casa_001.grid_y), (1, 0))
        self.assertEqual((casa_001.x, casa_001.y, casa_001.w, casa_001.h), (530.0, 156.0, 238.0, 133.0))
        self.assertEqual((com_001.grid_x, com_001.grid_y), (0, 0))
        self.assertEqual((com_001.x, com_001.y), (156.0, 156.0))
        self.assertEqual((praca_001.grid_x, praca_001.grid_y), (2, 2))
        self.assertEqual((praca_001.x, praca_001.y), (1018.0, 898.0))
        self.assertEqual((hosp_001.x, hosp_001.y), (530.0, 1500.0))

    def test_item_catalog_pure_mission_items_and_unique_location_validation(self) -> None:
        item = Item(id='moeda', name='Moeda', description='Ouro', image='assets/item-moeda-dourada.svg')
        item_md = serialize_item_markdown(item)
        self.assertNotIn('location:', item_md)
        self.assertNotIn('category:', item_md)
        self.assertNotIn('rarity:', item_md)
        parsed_item = parse_item_markdown(item_md, 'moeda.md')
        self.assertEqual(parsed_item.name, 'Moeda')

        pkg = load_story_package(self.app_copy, 'vibe-coding')
        self.assertGreater(len(pkg.collectibles), 0)
        first_mission = pkg.missions[pkg.missions_order[0]]
        first_mission.extra_items = [
            ExtraItemPlacement(item_id='caixa-secreta', location='PRACA-002', rarity='especial')
        ]
        mission_md = serialize_mission_markdown(first_mission)
        self.assertIn('## ITENS', mission_md)
        parsed_mission = parse_mission_markdown(mission_md, 'm.md')
        self.assertEqual(len(parsed_mission.extra_items), 1)
        self.assertEqual(parsed_mission.extra_items[0].location, 'PRACA-002')
        self.assertEqual(parsed_mission.extra_items[0].rarity, 'especial')

        # Mesmo item posicionado em dois locais diferentes deve falhar na validação
        dup_item_id = pkg.collectibles[0].item_id
        first_mission.extra_items = [
            ExtraItemPlacement(item_id=dup_item_id, location='CASA-001', rarity='normal')
        ]
        errors = validate_story(pkg, self.app_copy)
        self.assertTrue(any('mais de um local' in e for e in errors))

        # Dois itens diferentes no mesmo local também devem falhar na validação
        occupied_loc = pkg.collectibles[0].location
        pkg.items['novo-item'] = Item(id='novo-item', name='Novo', image='assets/item-moeda-dourada.svg')
        first_mission.extra_items = [
            ExtraItemPlacement(item_id='novo-item', location=occupied_loc, rarity='normal')
        ]
        errors_loc = validate_story(pkg, self.app_copy)
        self.assertTrue(any('cada local só pode ter um item' in e for e in errors_loc))


if __name__ == '__main__':
    unittest.main()
