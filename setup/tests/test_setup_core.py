from __future__ import annotations

from pathlib import Path
import shutil
import tempfile
import unittest

from setup.core.markdown_codec import (
    parse_map_markdown,
    serialize_map_markdown,
)
from setup.core.models import MapLocation
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
        shutil.copy2(APP_ROOT / 'story' / 'stories.json', self.app_copy / 'story' / 'stories.json')

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_load_and_validate_existing_vibe_coding_story(self) -> None:
        catalog = load_catalog(self.app_copy)
        self.assertEqual(len(catalog), 1)
        self.assertEqual(catalog[0].id, 'vibe-coding')

        pkg = load_story_package(self.app_copy, 'vibe-coding')
        self.assertEqual(pkg.title, 'GTA: Missão Vibe Coding')
        self.assertGreaterEqual(len(pkg.characters), 6)
        self.assertGreaterEqual(len(pkg.missions), 5)
        self.assertIn('extra-casa-hostnet', pkg.encounters)
        self.assertIn('CASA-63', pkg.locations)

        errors = validate_story(pkg, self.app_copy)
        self.assertEqual(errors, [])

    def test_create_save_and_delete_story_updates_catalog(self) -> None:
        pkg = create_story(self.app_copy, 'aventura-teste', 'Aventura de Teste', 'Descrição teste')
        self.assertEqual(pkg.id, 'aventura-teste')
        self.assertEqual(validate_story(pkg, self.app_copy), [])

        catalog = load_catalog(self.app_copy)
        self.assertEqual([e.id for e in catalog], ['vibe-coding', 'aventura-teste'])

        pkg.title = 'Aventura Editada'
        save_story_package(self.app_copy, pkg)
        reloaded = load_story_package(self.app_copy, 'aventura-teste')
        self.assertEqual(reloaded.title, 'Aventura Editada')

        delete_story(self.app_copy, 'aventura-teste')
        catalog_after = load_catalog(self.app_copy)
        self.assertEqual([e.id for e in catalog_after], ['vibe-coding'])
        self.assertFalse((self.app_copy / 'story' / 'aventura-teste').exists())

    def test_find_dependents_blocks_unsafe_deletion_and_validate_catches_broken_refs(self) -> None:
        pkg = load_story_package(self.app_copy, 'vibe-coding')
        char_refs = find_dependents(pkg, 'character', 'guanabara')
        self.assertTrue(len(char_refs) > 0)

        item_refs = find_dependents(pkg, 'item', 'caixa-secreta')
        self.assertTrue(len(item_refs) > 0)

        # Quebra proposital: código de local inexistente e cor inválida em rua
        pkg.missions['01-caixa-secreta'].target = 'CASA-9999'
        pkg.locations['RUA-01'].roof_color = '#123456'
        errors = validate_story(pkg, self.app_copy)
        self.assertTrue(any('CASA-9999' in err for err in errors))
        self.assertTrue(any('RUA-01' in err for err in errors))

    def test_map_roof_roundtrip_and_asset_import_validation(self) -> None:
        locs = {
            'RUA-01': MapLocation(code='RUA-01', name='Av. Central', kind='RUA'),
            'CASA-10': MapLocation(
                code='CASA-10',
                name='Casa Azul',
                kind='CASA',
                roof_color='#2563eb',
                roof_logo='assets/alex-front.svg',
            ),
        }
        serialized = serialize_map_markdown(locs)
        parsed = parse_map_markdown(serialized)
        self.assertEqual(parsed['CASA-10'].roof_color, '#2563eb')
        self.assertEqual(parsed['CASA-10'].roof_logo, 'assets/alex-front.svg')
        self.assertEqual(parsed['RUA-01'].name, 'Av. Central')

        bad_file = self.tmp_dir / 'script.exe'
        bad_file.write_text('x', encoding='utf-8')
        with self.assertRaises(StoryIOError):
            import_asset_file(self.app_copy / 'story' / 'vibe-coding', bad_file)


if __name__ == '__main__':
    unittest.main()
